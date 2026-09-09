"""Extract eval results for HF-published models into hf/eval.json.

Reads the eval result JSONs and training manifests for each model
defined in hf/models.json and writes hf/eval.json, which the publish
script uses for the README.

Usage:
    uv run scripts/extract_eval.py
"""

import json
from pathlib import Path

MODELS_PATH = Path("hf/models.json")
OUTPUT_PATH = Path("hf/eval.json")


def _find_result_file(model_dir: Path) -> Path | None:
    """Find the eval result JSON for a model directory.

    Result files live in the sibling results/ directory, named
    {model_name}_seq2seq_test_test.json.
    """
    encoder_dir = model_dir.parent.parent
    results_dir = encoder_dir / "results"
    pattern = f"{model_dir.name}_seq2seq_test_test.json"
    path = results_dir / pattern
    return path if path.exists() else None


def main():
    models = json.loads(MODELS_PATH.read_text())
    output: dict[str, dict] = {}

    for repo_name, config in models.items():
        model_dir = Path(config["model_dir"])
        manifest = json.loads((model_dir / "manifest.json").read_text())

        result_path = _find_result_file(model_dir)
        if result_path is None:
            print(f"  {repo_name}: no eval result found, skipping")
            continue

        result = json.loads(result_path.read_text())
        model_config = manifest["model"]

        output[repo_name] = {
            "n_params": manifest["results"]["n_params"],
            "embed_dim": model_config["embed_dim"],
            "num_layers": model_config["num_layers"],
            "vocab_size": model_config["vocab_size"],
            "n_samples": result["n_samples"],
            "tok_f1": round(result["mean_f1"], 3),
            "exact_match": round(result["exact_match"], 3),
            "validity": round(result["validity_rate"], 3),
            "vocab_diversity": round(result["vocab_diversity"], 3),
            "rouge_l": round(result["mean_rouge_l"], 3),
            "bertscore_f1": round(result["mean_bertscore_f1"], 3),
        }

        print(f"{repo_name}:")
        print(f"  tok_f1={output[repo_name]['tok_f1']}")
        print(f"  exact_match={output[repo_name]['exact_match']}")
        print(f"  validity={output[repo_name]['validity']}")
        print(f"  vocab_diversity={output[repo_name]['vocab_diversity']}")

    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n")
    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
