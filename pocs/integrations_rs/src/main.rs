#![allow(
    clippy::missing_errors_doc,
    clippy::print_stdout,
    clippy::print_stderr,
    clippy::exit,
    clippy::use_debug
)]

//! CLI for the V1 durable integration control layer.

use integrations_rs::application::{
    DurableIntegrationService, IntegrationService as _, RequestContext, SubmitIntegration,
};
use integrations_rs::config::Env;
use integrations_rs::orchestrator::{InvocationV1, SubmissionTriggerV1};
use integrations_rs::yaml::Source;
use std::num::{NonZeroU64, NonZeroUsize};
use std::str::FromStr;
use std::sync::Arc;

use clap::builder::TypedValueParser as _;
use clap::{Args, Parser, Subcommand};
use integrations_rs::orchestrator::ids::RunId;

#[derive(Debug, Parser)]
#[command(
    name = "integrations_rs",
    version,
    about = "Run durable data integrations"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    #[command(about = "Submit an integration definition")]
    Submit {
        #[arg(value_parser = clap::builder::StringValueParser::new().map(Source::Text))]
        definition: Source,
        #[arg(long)]
        links_only: bool,
        #[arg(long, value_name = "SOURCE[=TIMESTAMP]")]
        replay_bronze: Vec<ReplaySource>,
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Inspect a run")]
    Status(RunArgs),
    #[command(about = "Request cancellation of a run")]
    Cancel(RunArgs),
    #[command(about = "Inspect or change runtime settings")]
    Tune {
        #[command(subcommand)]
        command: Option<TuneCommand>,
    },
    #[command(about = "Check node configuration")]
    Doctor,
    #[command(about = "Verify stored integration state")]
    VerifyStore {
        #[arg(long)]
        full: bool,
    },
    #[command(about = "Start the HTTP API and worker")]
    Serve(ActivationArgs),
    #[command(about = "Process durable work")]
    Worker(ActivationArgs),
}

#[derive(Debug, Args)]
struct ActivationArgs {
    #[arg(long = "activate-baseline", required = true)]
    _activate_baseline: bool,
}

#[derive(Debug, Args)]
struct RunArgs {
    #[arg(value_parser = parse_run_id)]
    run_id: RunId,
    #[arg(long)]
    json: bool,
}

fn parse_run_id(value: &str) -> Result<RunId, integrations_rs::orchestrator::ids::InvalidId> {
    RunId::parse(value)
}

#[derive(Debug, Subcommand)]
enum TuneCommand {
    Show,
    Concurrency { value: Setting<NonZeroUsize> },
    GraphRps { value: Setting<NonZeroU64> },
}

#[derive(Debug, Clone)]
enum Setting<T> {
    Default,
    Value(T),
}

impl<T: FromStr> FromStr for Setting<T> {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value == "default" {
            Ok(Self::Default)
        } else {
            value
                .parse()
                .map(Self::Value)
                .map_err(|_error| "expected a positive integer or 'default'".to_owned())
        }
    }
}

#[derive(Debug, Clone)]
struct ReplaySource {
    source: String,
    timestamp: Option<String>,
}

impl FromStr for ReplaySource {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let (source, timestamp) = match value.split_once('=') {
            Some((source, timestamp)) if !source.is_empty() && !timestamp.is_empty() => {
                (source, Some(timestamp.to_owned()))
            }
            None if !value.is_empty() => (value, None),
            _ => {
                return Err("expected a source name optionally followed by '=TIMESTAMP'".to_owned())
            }
        };
        Ok(Self {
            source: source.to_owned(),
            timestamp,
        })
    }
}

fn main() {
    let cli = Cli::parse();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("warn,integrations_rs=info")
            }),
        )
        .init();

    // Load .env before the tokio runtime spawns worker threads: set_var while
    // other threads may getenv is undefined behavior on POSIX (and a hard
    // error in edition 2024). Doing it here keeps it single-threaded.
    load_dotenv(".env");

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    let code = runtime.block_on(dispatch(cli.command));
    std::process::exit(code);
}

async fn dispatch(command: Command) -> i32 {
    let env = Env::process();
    match command {
        Command::Submit {
            definition,
            links_only,
            replay_bronze,
            json,
        } => {
            let invocation = InvocationV1 {
                links_only,
                replay: replay_bronze
                    .into_iter()
                    .map(|entry| (entry.source, entry.timestamp))
                    .collect(),
            };
            submit_durable(definition, invocation, json, env).await
        }
        Command::Status(args) => durable_status(args, env).await,
        Command::Cancel(args) => durable_cancel(args, env).await,
        Command::Tune { command } => durable_tune(command, &env).await,
        Command::Doctor => production_doctor(&env).await,
        Command::VerifyStore { full } => production_verify_store(full, &env).await,
        Command::Serve(_) => production_serve(&env).await,
        Command::Worker(_) => production_worker(&env).await,
    }
}

async fn production_serve(env: &Env) -> i32 {
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

async fn production_worker(env: &Env) -> i32 {
    match integrations_rs::production::run_worker(env).await {
        Ok(()) => 0,
        Err(error) => {
            print_worker_error("worker stopped", &error);
            1
        }
    }
}

async fn production_doctor(env: &Env) -> i32 {
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

async fn production_verify_store(full: bool, env: &Env) -> i32 {
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

async fn submit_durable(
    definition: Source,
    invocation: InvocationV1,
    json_output: bool,
    env: Env,
) -> i32 {
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
                source: definition,
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
                    "{} run {} (acceptance event {})",
                    if outcome.created {
                        "submitted"
                    } else {
                        "already active; attached to"
                    },
                    outcome.run_id,
                    outcome.acceptance_event_id
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

async fn durable_status(args: RunArgs, env: Env) -> i32 {
    let context = match local_request_context(&env) {
        Ok(context) => context,
        Err(message) => {
            eprintln!("status unavailable: {message}");
            return 1;
        }
    };
    let service = DurableIntegrationService::new(env);
    match service.status(context, None, &args.run_id).await {
        Ok(result) if args.json => {
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

async fn durable_cancel(args: RunArgs, env: Env) -> i32 {
    let context = match local_request_context(&env) {
        Ok(context) => context,
        Err(message) => {
            eprintln!("cancel unavailable: {message}");
            return 1;
        }
    };
    let service = DurableIntegrationService::new(env);
    match service.cancel(context, None, &args.run_id).await {
        Ok(request) => {
            if args.json {
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

async fn durable_tune(command: Option<TuneCommand>, env: &Env) -> i32 {
    use integrations_rs::runtime_settings::{GraphDeliverySettingsV1, RuntimeSettingsStore};

    let store = match RuntimeSettingsStore::open(env) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("runtime settings unavailable: {error:?}");
            return 1;
        }
    };
    let result = match command {
        None | Some(TuneCommand::Show) => store.load().await,
        Some(TuneCommand::Concurrency { value }) => {
            let value = match value {
                Setting::Default => None,
                Setting::Value(count) => Some(count.get()),
            };
            store.set_concurrency(value).await
        }
        Some(TuneCommand::GraphRps { value }) => {
            let Some(web_id) = env
                .get("HASH_WEB_ID")
                .map(str::trim)
                .filter(|id| !id.is_empty())
            else {
                eprintln!("error: HASH_WEB_ID is required to tune Graph requests per second");
                return 64;
            };
            let value = match value {
                Setting::Default => None,
                Setting::Value(rate) => Some(GraphDeliverySettingsV1 {
                    requests_per_second: rate.get(),
                }),
            };
            store.set_graph_delivery(web_id, value).await
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
    fn submit_parses_options_in_either_position() {
        for args in [
            vec![
                "integrations_rs",
                "submit",
                "example.yaml",
                "--links-only",
                "--replay-bronze",
                "orders=2026-07-10",
                "--json",
            ],
            vec![
                "integrations_rs",
                "submit",
                "--json",
                "--links-only",
                "--replay-bronze=orders=2026-07-10",
                "example.yaml",
            ],
        ] {
            let cli = Cli::try_parse_from(args).expect("submission arguments should parse");
            let Command::Submit {
                definition,
                links_only,
                replay_bronze,
                json,
            } = cli.command
            else {
                panic!("submission should produce the submit command");
            };
            assert!(matches!(definition, Source::Text(text) if text == "example.yaml"));
            assert!(links_only && json);
            assert_eq!(replay_bronze[0].source, "orders");
            assert_eq!(replay_bronze[0].timestamp.as_deref(), Some("2026-07-10"));
        }
    }

    #[test]
    fn malformed_arguments_are_rejected_before_dispatch() {
        for args in [
            vec!["submit"],
            vec!["submit", "example.yaml", "--unknown"],
            vec!["submit", "example.yaml", "--replay-bronze"],
            vec!["submit", "example.yaml", "--replay-bronze=orders="],
            vec!["status", "not-a-run-id"],
            vec!["cancel", "not-a-run-id"],
            vec!["tune", "concurrency", "0"],
            vec!["tune", "concurrency", "18446744073709551616"],
            vec!["tune", "graph-rps", "0"],
            vec!["tune", "graph-rps", "-1"],
            vec!["tune", "graph-rps", "18446744073709551616"],
            vec!["worker"],
            vec!["serve"],
            vec!["worker", "--activate-baseline", "--force"],
            vec!["doctor", "extra"],
        ] {
            assert!(
                Cli::try_parse_from(std::iter::once("integrations_rs").chain(args.clone()))
                    .is_err(),
                "{args:?} should be rejected"
            );
        }
    }

    #[test]
    fn run_ids_and_settings_are_typed() {
        let id = RunId::generate();
        let cli = Cli::try_parse_from(["integrations_rs", "status", "--json", id.as_str()])
            .expect("status arguments should parse");
        let Command::Status(args) = cli.command else {
            panic!("status should produce a status command");
        };
        assert_eq!(args.run_id, id);
        assert!(args.json);
        for value in ["1", "default"] {
            let concurrency =
                Cli::try_parse_from(["integrations_rs", "tune", "concurrency", value])
                    .expect("positive or default concurrency should parse");
            let rate = Cli::try_parse_from(["integrations_rs", "tune", "graph-rps", value])
                .expect("positive or default request rate should parse");
            match (value, concurrency.command, rate.command) {
                (
                    "1",
                    Command::Tune {
                        command:
                            Some(TuneCommand::Concurrency {
                                value: Setting::Value(count),
                            }),
                    },
                    Command::Tune {
                        command:
                            Some(TuneCommand::GraphRps {
                                value: Setting::Value(rate),
                            }),
                    },
                ) => {
                    assert_eq!(count.get(), 1);
                    assert_eq!(rate.get(), 1);
                }
                (
                    "default",
                    Command::Tune {
                        command:
                            Some(TuneCommand::Concurrency {
                                value: Setting::Default,
                            }),
                    },
                    Command::Tune {
                        command:
                            Some(TuneCommand::GraphRps {
                                value: Setting::Default,
                            }),
                    },
                ) => {}
                _ => panic!("tuning arguments should preserve the typed setting"),
            }
        }
    }

    #[test]
    fn command_definitions_are_consistent() {
        use clap::CommandFactory as _;
        Cli::command().debug_assert();
        assert_eq!(
            Cli::try_parse_from(["integrations_rs", "--help"])
                .expect_err("help should return a display-help result")
                .kind(),
            clap::error::ErrorKind::DisplayHelp
        );
    }
}
