#![allow(
    clippy::missing_errors_doc,
    clippy::print_stdout,
    clippy::print_stderr,
    clippy::exit,
    clippy::use_debug
)]

//! CLI for the V1 durable integration control plane.

use integrations_rs::application::{
    DurableIntegrationService, IntegrationService as _, RequestContext, SubmitIntegration,
};
use integrations_rs::config::Env;
use integrations_rs::orchestrator::{InvocationV1, SubmissionTriggerV1};
use integrations_rs::yaml::Source;
use std::sync::Arc;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("warn,integrations_rs=info")
            }),
        )
        .init();

    // Load .env BEFORE the tokio runtime spawns worker threads: set_var while
    // other threads may getenv is undefined behavior on POSIX (and a hard
    // error in edition 2024). Doing it here keeps it single-threaded.
    load_dotenv(".env");

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    let code = runtime.block_on(dispatch(std::env::args().skip(1).collect()));
    std::process::exit(code);
}

async fn dispatch(args: Vec<String>) -> i32 {
    let env = Env::process();

    match args.first().map(String::as_str) {
        Some("submit") => {
            let Some(definition) = args.get(1) else {
                eprintln!("error: submit requires a definition\n\n{}", durable_usage());
                return 64;
            };
            submit_durable(definition, &args[2..], env).await
        }
        Some("status") => durable_status(&args[1..], env).await,
        Some("cancel") => durable_cancel(&args[1..], env).await,
        Some("tune") => durable_tune(&args[1..], &env).await,
        Some("doctor") => production_doctor(&args[1..], &env).await,
        Some("verify-store") => production_verify_store(&args[1..], &env).await,
        Some("serve") => production_serve(&args[1..], &env).await,
        Some("worker") => production_worker(&args[1..], &env).await,
        Some("help" | "--help" | "-h") => {
            println!("{}", usage());
            0
        }
        _ => {
            eprintln!("{}", usage());
            64
        }
    }
}

const fn usage() -> &'static str {
    "Usage:
  integrations_rs submit <definition> [--links-only] [--replay-bronze source[=ts]] [--json]
  integrations_rs status <task-id> [--json]
  integrations_rs cancel <task-id> [--json]
  integrations_rs tune
  integrations_rs tune concurrency <count|default>
  integrations_rs tune graph-rps <requests-per-second|default>
  integrations_rs doctor
  integrations_rs verify-store [--full]
  integrations_rs serve --activate-baseline
  integrations_rs worker --activate-baseline

Durable commands use the blob-backed OpenData/SlateDB backend."
}

async fn production_serve(args: &[String], env: &Env) -> i32 {
    if args != ["--activate-baseline"] {
        eprintln!(
            "serve refuses to start without explicit baseline activation\n\nUsage: integrations_rs serve --activate-baseline"
        );
        return 64;
    }
    let bind = env
        .get("INTEGRATIONS_HTTP_BIND")
        .unwrap_or("127.0.0.1:3000");
    let listener = match tokio::net::TcpListener::bind(bind).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("HTTP API could not bind to {bind}: {error}");
            return 1;
        }
    };
    let address = listener
        .local_addr()
        .map_or_else(|_| bind.to_owned(), |address| address.to_string());
    let service: Arc<dyn integrations_rs::application::IntegrationService> =
        Arc::new(integrations_rs::application::DurableIntegrationService::new(env.clone()));
    let shutdown = tokio_util::sync::CancellationToken::new();
    let worker = integrations_rs::production::run_worker_until(env, shutdown.clone());
    let api = integrations_rs::web_api::serve(listener, service, shutdown.clone());
    tokio::pin!(worker);
    tokio::pin!(api);
    tracing::info!(bind = %address, docs = %format!("http://{address}/docs"), "integrations node listening");

    tokio::select! {
        signal = tokio::signal::ctrl_c() => {
            if let Err(error) = signal {
                eprintln!("shutdown signal failed: {error}");
                shutdown.cancel();
                return 1;
            }
            shutdown.cancel();
            let (worker_result, api_result) = tokio::join!(worker, api);
            report_node_results(worker_result, api_result)
        }
        worker_result = &mut worker => {
            shutdown.cancel();
            let api_result = api.await;
            report_node_results(worker_result, api_result)
        }
        api_result = &mut api => {
            shutdown.cancel();
            let worker_result = worker.await;
            report_node_results(worker_result, api_result)
        }
    }
}

fn report_node_results(
    worker: Result<(), error_stack::Report<integrations_rs::orchestrator::runner::WorkerError>>,
    api: std::io::Result<()>,
) -> i32 {
    let worker_failed = if let Err(error) = worker {
        print_worker_error("worker stopped", &error);
        true
    } else {
        false
    };
    let api_failed = if let Err(error) = api {
        eprintln!("HTTP API stopped: {error}");
        true
    } else {
        false
    };
    i32::from(worker_failed || api_failed)
}

async fn production_worker(args: &[String], env: &Env) -> i32 {
    match args {
        [] => {
            eprintln!(
                "worker refuses to start without explicit baseline activation\n\nUsage: integrations_rs worker --activate-baseline"
            );
            1
        }
        [flag] if flag == "--activate-baseline" => {
            match integrations_rs::production::run_worker(env).await {
                Ok(()) => 0,
                Err(error) => {
                    print_worker_error("worker stopped", &error);
                    1
                }
            }
        }
        _ => {
            eprintln!(
                "error: unknown worker arguments\n\nUsage: integrations_rs worker --activate-baseline"
            );
            64
        }
    }
}

async fn production_doctor(args: &[String], env: &Env) -> i32 {
    if !args.is_empty() {
        eprintln!("error: doctor takes no arguments\n\nUsage: integrations_rs doctor");
        return 64;
    }
    match integrations_rs::production::doctor(env).await {
        Ok(report) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("doctor report always serializes")
            );
            0
        }
        Err(error) => {
            print_diagnostics_error("doctor failed", &error);
            1
        }
    }
}

async fn production_verify_store(args: &[String], env: &Env) -> i32 {
    let full = match args {
        [] => false,
        [flag] if flag == "--full" => true,
        _ => {
            eprintln!(
                "error: unknown verify-store arguments\n\nUsage: integrations_rs verify-store [--full]"
            );
            return 64;
        }
    };
    match integrations_rs::production::verify_store(env, full).await {
        Ok(report) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report)
                    .expect("store verification report always serializes")
            );
            0
        }
        Err(error) => {
            print_diagnostics_error("store verification failed", &error);
            1
        }
    }
}

fn print_diagnostics_error(
    label: &str,
    report: &error_stack::Report<integrations_rs::error::DiagnosticsError>,
) {
    let details: Vec<String> = report
        .frames()
        .filter_map(|frame| match frame.kind() {
            error_stack::FrameKind::Attachment(error_stack::AttachmentKind::Printable(value)) => {
                Some(value.to_string())
            }
            _ => None,
        })
        .collect();
    if details.is_empty() {
        eprintln!("{label}: {report:?}");
    } else {
        eprintln!("{label}: {}", details.join(": "));
    }
}

const fn durable_usage() -> &'static str {
    "Usage: integrations_rs submit <definition> [--links-only] [--replay-bronze source[=ts]] [--json]"
}

async fn submit_durable(definition: &str, flags: &[String], env: Env) -> i32 {
    let (invocation, json_output) = match parse_durable_submit_flags(flags) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("error: {message}\n\n{}", durable_usage());
            return 64;
        }
    };
    let context = match local_request_context(&env) {
        Ok(context) => context,
        Err(message) => {
            eprintln!("submission unavailable: {message}");
            return 1;
        }
    };
    let service = DurableIntegrationService::new(env);
    match service
        .submit(
            context,
            SubmitIntegration {
                connector_id: None,
                source: Source::from_arg(definition),
                invocation,
                trigger: SubmissionTriggerV1::Manual,
                trace_context: serde_json::Map::new(),
            },
        )
        .await
    {
        Ok(outcome) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::to_string(&outcome).expect("SubmitOutcome always serializes")
                );
            } else {
                println!(
                    "{} run {} (initial revision {})",
                    if outcome.created {
                        "submitted"
                    } else {
                        "already active; attached to"
                    },
                    outcome.run_id,
                    outcome.initial_revision
                );
                println!("inspect: integrations_rs status {}", outcome.run_id);
                println!("cancel:  integrations_rs cancel {}", outcome.run_id);
            }
            0
        }
        Err(error) => {
            eprintln!("submission failed: {error}");
            1
        }
    }
}

fn parse_durable_submit_flags(flags: &[String]) -> Result<(InvocationV1, bool), String> {
    let mut invocation = InvocationV1::default();
    let mut json_output = false;
    let mut index = 0;
    while index < flags.len() {
        match flags[index].as_str() {
            "--links-only" => invocation.links_only = true,
            "--json" => json_output = true,
            "--replay-bronze" => {
                index += 1;
                let entry = flags
                    .get(index)
                    .ok_or_else(|| "--replay-bronze requires source[=timestamp]".to_owned())?;
                match entry.split_once('=') {
                    Some((source, timestamp)) if !source.is_empty() && !timestamp.is_empty() => {
                        invocation
                            .replay
                            .insert(source.to_owned(), Some(timestamp.to_owned()));
                    }
                    Some(_) => {
                        return Err(
                            "--replay-bronze requires non-empty source[=timestamp]".to_owned()
                        );
                    }
                    None if !entry.is_empty() => {
                        invocation.replay.insert(entry.clone(), None);
                    }
                    None => return Err("--replay-bronze source must not be empty".to_owned()),
                }
            }
            unknown => return Err(format!("unknown submit option {unknown:?}")),
        }
        index += 1;
    }
    Ok((invocation, json_output))
}

async fn durable_status(args: &[String], env: Env) -> i32 {
    let (task_id, json_output) = match parse_task_command("status", args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("error: {message}\n\nUsage: integrations_rs status <task-id> [--json]");
            return 64;
        }
    };
    let context = match local_request_context(&env) {
        Ok(context) => context,
        Err(message) => {
            eprintln!("status unavailable: {message}");
            return 1;
        }
    };
    let service = DurableIntegrationService::new(env);
    match service.status(context, None, &task_id).await {
        Ok(result) if json_output => {
            println!(
                "{}",
                serde_json::to_string(&result).expect("command status always serializes")
            );
            0
        }
        Ok(result) => {
            println!("run {}: {}", result.run_id, result.state);
            println!("integration: {}", result.integration_id);
            println!("revision: {}", result.revision);
            if let Some(value) = result.result {
                println!(
                    "result: {}",
                    serde_json::to_string_pretty(&value).expect("JSON value always serializes")
                );
            }
            if let Some(failure) = result.failure {
                eprintln!(
                    "failure: {}",
                    serde_json::to_string_pretty(&failure).expect("JSON value always serializes")
                );
            }
            0
        }
        Err(error) => {
            eprintln!("status failed: {error}");
            1
        }
    }
}

async fn durable_cancel(args: &[String], env: Env) -> i32 {
    let (task_id, json_output) = match parse_task_command("cancel", args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("error: {message}\n\nUsage: integrations_rs cancel <task-id> [--json]");
            return 64;
        }
    };
    let context = match local_request_context(&env) {
        Ok(context) => context,
        Err(message) => {
            eprintln!("cancel unavailable: {message}");
            return 1;
        }
    };
    let service = DurableIntegrationService::new(env);
    match service.cancel(context, None, &task_id).await {
        Ok(request) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::to_string(&request)
                        .expect("published cancellation always serializes")
                );
            } else {
                println!(
                    "queued cancellation request {} for run {}",
                    request.request_id, request.run_id
                );
                println!("expected revision: {}", request.expected_revision);
            }
            0
        }
        Err(error) => {
            eprintln!("cancel failed: {error}");
            1
        }
    }
}

fn local_request_context(env: &Env) -> Result<RequestContext, &'static str> {
    let web_id = env
        .get("HASH_WEB_ID")
        .filter(|value| !value.trim().is_empty())
        .ok_or("HASH_WEB_ID is required")?;
    Ok(RequestContext {
        web_id: web_id.to_owned(),
        actor_id: env.get("HASH_ACTOR_ID").map(str::to_owned),
        request_id: None,
    })
}

async fn durable_tune(args: &[String], env: &Env) -> i32 {
    use integrations_rs::runtime_settings::{GraphDeliverySettingsV1, RuntimeSettingsStore};

    let store = match RuntimeSettingsStore::open(env) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("runtime settings unavailable: {error:?}");
            return 1;
        }
    };
    let result = match args {
        [] => store.load().await,
        [show] if show == "show" => store.load().await,
        [kind, value] if kind == "concurrency" => {
            let value = if value == "default" {
                None
            } else {
                match value.parse::<usize>() {
                    Ok(value) if value > 0 => Some(value),
                    _ => {
                        eprintln!("error: concurrency must be a positive integer or 'default'");
                        return 64;
                    }
                }
            };
            store.set_concurrency(value).await
        }
        [kind, value] if kind == "graph-rps" => {
            let Some(web_id) = env
                .get("HASH_WEB_ID")
                .map(str::trim)
                .filter(|id| !id.is_empty())
            else {
                eprintln!("error: HASH_WEB_ID is required to tune Graph requests per second");
                return 64;
            };
            let value = if value == "default" {
                None
            } else {
                match value.parse::<u64>() {
                    Ok(requests_per_second) if requests_per_second > 0 => {
                        Some(GraphDeliverySettingsV1 {
                            requests_per_second,
                        })
                    }
                    _ => {
                        eprintln!(
                            "error: Graph requests per second must be a positive integer or 'default'"
                        );
                        return 64;
                    }
                }
            };
            store.set_graph_delivery(web_id, value).await
        }
        _ => {
            eprintln!(
                "Usage:\n  integrations_rs tune\n  integrations_rs tune concurrency <count|default>\n  integrations_rs tune graph-rps <requests-per-second|default>"
            );
            return 64;
        }
    };
    match result {
        Ok(settings) => {
            let startup_ceiling = integrations_rs::config::max_concurrent_integrations(env);
            let effective_concurrency = settings
                .max_concurrent_integrations
                .unwrap_or(startup_ceiling)
                .min(startup_ceiling);
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "settings": settings,
                    "effectiveOnThisHost": {
                        "maxConcurrentIntegrations": effective_concurrency,
                        "startupConcurrencyCeiling": startup_ceiling,
                        "observedWithinMs": integrations_rs::config::runtime_settings_refresh_ms(env),
                    }
                }))
                .expect("runtime settings always serialize")
            );
            0
        }
        Err(error) => {
            eprintln!("runtime settings update failed: {error:?}");
            1
        }
    }
}

fn parse_task_command(command: &str, args: &[String]) -> Result<(String, bool), String> {
    let task_id_text = args
        .first()
        .ok_or_else(|| format!("{command} requires a task ID"))?;
    if task_id_text.trim().is_empty() {
        return Err("task ID must not be empty".to_owned());
    }
    let task_id = task_id_text.clone();
    let json_output = match args.get(1).map(String::as_str) {
        None => false,
        Some("--json") => true,
        Some(unknown) => return Err(format!("unknown {command} option {unknown:?}")),
    };
    if args.len() > 2 {
        return Err(format!("too many arguments for {command}"));
    }
    Ok((task_id, json_output))
}

fn print_worker_error(
    label: &str,
    report: &error_stack::Report<integrations_rs::orchestrator::runner::WorkerError>,
) {
    eprintln!("{label}: {}", report.current_context());
    for detail in report.frames().filter_map(|frame| match frame.kind() {
        error_stack::FrameKind::Attachment(error_stack::AttachmentKind::Printable(value)) => {
            Some(value.to_string())
        }
        _ => None,
    }) {
        eprintln!("caused by: {detail}");
    }
}

fn load_dotenv(path: &str) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            // Shell environment wins over .env, matching the other engines.
            if std::env::var(key).is_err() {
                std::env::set_var(key, value.trim());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durable_submit_flags_are_strict_and_preserve_invocation() {
        let flags = vec![
            "--links-only".to_owned(),
            "--replay-bronze".to_owned(),
            "source-a=2026-07-10T12:00:00Z".to_owned(),
            "--json".to_owned(),
        ];
        let (invocation, json) = parse_durable_submit_flags(&flags).expect("valid flags");
        assert!(invocation.links_only);
        assert!(json);
        assert_eq!(
            invocation.replay.get("source-a"),
            Some(&Some("2026-07-10T12:00:00Z".to_owned()))
        );

        assert!(parse_durable_submit_flags(&["--replay-bronze".to_owned()]).is_err());
        assert!(parse_durable_submit_flags(&["--unknown".to_owned()]).is_err());
    }

    #[test]
    fn run_commands_defer_typed_id_validation_and_reject_extra_arguments() {
        assert_eq!(
            parse_task_command("status", &["redis-stream:1712-0".to_owned()])
                .expect("syntax parsing leaves typed validation to the command surface")
                .0,
            "redis-stream:1712-0"
        );
        let id = uuid::Uuid::new_v4().to_string();
        assert!(
            parse_task_command("status", &[id, "--json".to_owned(), "extra".to_owned()]).is_err()
        );
    }
}
