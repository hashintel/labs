//! Stable Kahn topological sort of pipelines by declared `dependsOn`,
//! checkpoint `inputs`, and cross-pipeline step deps, ported with the same
//! errors as the TS/Elixir engines.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use crate::build::{Pipeline, Step, StepKind};

pub fn sort_pipelines(pipelines: &[Pipeline]) -> Result<Vec<&Pipeline>, String> {
    if pipelines.is_empty() {
        return Ok(vec![]);
    }

    let steps_by_pipeline: Vec<Vec<&Step>> = pipelines
        .iter()
        .map(|pipeline| linearize(&pipeline.steps))
        .collect();

    let mut source_to_index = HashMap::new();
    for (index, pipeline) in pipelines.iter().enumerate() {
        if source_to_index
            .insert(pipeline.source.clone(), index)
            .is_some()
        {
            return Err(fail(format!(
                "Duplicate pipeline source \"{}\".",
                pipeline.source
            )));
        }
    }

    let mut step_index: HashMap<&str, (usize, &Step)> = HashMap::new();
    let mut checkpoint_names: HashMap<&str, (usize, &str)> = HashMap::new();
    for (index, steps) in steps_by_pipeline.iter().enumerate() {
        for step in steps {
            if let Some((previous, _)) = step_index.get(step.id.as_str()) {
                return Err(fail(format!(
                    "Duplicate step id \"{}\" in pipelines \"{}\" and \"{}\".",
                    step.id, pipelines[*previous].source, pipelines[index].source
                )));
            }
            step_index.insert(&step.id, (index, step));

            if let StepKind::Checkpoint { name } = &step.kind {
                if let Some((previous, previous_id)) = checkpoint_names.get(name.as_str()) {
                    return Err(fail(format!(
                        "Duplicate checkpoint name \"{name}\" produced by steps \"{previous_id}\" (pipeline \"{}\") and \"{}\" (pipeline \"{}\").",
                        pipelines[*previous].source, step.id, pipelines[index].source
                    )));
                }
                checkpoint_names.insert(name, (index, &step.id));
            }
        }
    }

    let mut deps: BTreeMap<usize, HashSet<usize>> = BTreeMap::new();
    for (index, pipeline) in pipelines.iter().enumerate() {
        let mut pipeline_deps = HashSet::new();

        for name in &pipeline.depends_on {
            match source_to_index.get(name) {
                Some(target) if *target == index => {
                    return Err(fail(format!(
                        "Pipeline \"{}\" dependsOn itself.",
                        pipeline.source
                    )));
                }
                Some(target) => {
                    pipeline_deps.insert(*target);
                }
                None => {
                    return Err(fail(format!(
                        "Pipeline \"{}\" dependsOn \"{name}\", but no such pipeline is declared.",
                        pipeline.source
                    )));
                }
            }
        }

        for (_, checkpoint_name) in &pipeline.inputs {
            match checkpoint_names.get(checkpoint_name.as_str()) {
                Some((target, _)) if *target == index => {
                    return Err(fail(format!(
                        "Pipeline \"{}\" inputs its own checkpoint \"{checkpoint_name}\".",
                        pipeline.source
                    )));
                }
                Some((target, _)) => {
                    pipeline_deps.insert(*target);
                }
                None => {
                    return Err(fail(format!(
                        "Pipeline \"{}\" inputs checkpoint \"{checkpoint_name}\", but no pipeline produces it.",
                        pipeline.source
                    )));
                }
            }
        }

        deps.insert(index, pipeline_deps);
    }

    let sorted = kahn(&deps, pipelines)?;
    Ok(sorted.into_iter().map(|index| &pipelines[index]).collect())
}

fn kahn(
    deps: &BTreeMap<usize, HashSet<usize>>,
    pipelines: &[Pipeline],
) -> Result<Vec<usize>, String> {
    let n = pipelines.len();
    let mut in_degree: Vec<usize> = (0..n).map(|index| deps[&index].len()).collect();
    let mut children: HashMap<usize, Vec<usize>> = HashMap::new();
    for (index, parents) in deps {
        for parent in parents {
            children.entry(*parent).or_default().push(*index);
        }
    }
    for list in children.values_mut() {
        list.sort_unstable();
    }

    let mut queue: VecDeque<usize> = (0..n).filter(|index| in_degree[*index] == 0).collect();
    let mut sorted = Vec::with_capacity(n);

    while let Some(index) = queue.pop_front() {
        sorted.push(index);
        for child in children.get(&index).map(Vec::as_slice).unwrap_or(&[]) {
            in_degree[*child] -= 1;
            if in_degree[*child] == 0 {
                queue.push_back(*child);
            }
        }
    }

    if sorted.len() == n {
        Ok(sorted)
    } else {
        let emitted: HashSet<usize> = sorted.iter().copied().collect();
        let remaining: Vec<&str> = (0..n)
            .filter(|index| !emitted.contains(index))
            .map(|index| pipelines[index].source.as_str())
            .collect();
        Err(fail(format!(
            "Cyclic pipeline dependencies involving: {}.",
            remaining.join(", ")
        )))
    }
}

fn linearize(steps: &[Step]) -> Vec<&Step> {
    let mut out = vec![];
    for step in steps {
        out.push(step);
        if let StepKind::Branch { branches } = &step.kind {
            for branch in branches {
                out.extend(linearize(branch));
            }
        }
    }
    out
}

fn fail(message: String) -> String {
    format!("Topology error: {message}")
}
