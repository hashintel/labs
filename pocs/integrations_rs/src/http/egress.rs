//! REST requests use HTTP or HTTPS and public destination addresses.
//! Each page's URL is checked before sending. The client's DNS resolver also
//! checks the addresses it passes to the connection, including on retries.
//! `INTEGRATIONS_ALLOW_PRIVATE_HOSTS` allows private destinations for local use.

use std::net::IpAddr;

use error_stack::Report;

use crate::config::{self, Env};
use crate::error::SourceError;

/// Pair this client with `validate_url` for each request. URL validation checks
/// IP literals, which bypass the client's DNS resolver.
pub(crate) fn client(env: &Env) -> reqwest::Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        // A proxy could resolve the destination outside our address checks.
        .no_proxy();
    if !config::allow_private_hosts(env) {
        builder = builder.dns_resolver(std::sync::Arc::new(PublicResolver));
    }
    builder.build()
}

struct PublicResolver;

impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let addresses = tokio::net::lookup_host((name.as_str(), 0))
                .await?
                .collect::<Vec<_>>();
            if addresses.is_empty() || addresses.iter().any(|address| private(&address.ip())) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "egress blocked because DNS did not return exclusively public addresses",
                )
                .into());
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

pub async fn validate_url(url: &str, env: &Env) -> Result<(), Report<SourceError>> {
    let parsed = reqwest::Url::parse(url).map_err(|_error| {
        Report::new(SourceError).attach_printable("egress blocked: configured URL is invalid")
    })?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(Report::new(SourceError).attach_printable(format!(
            "egress blocked: only http/https URLs are allowed, got scheme {:?}",
            parsed.scheme()
        )));
    }

    let Some(host) = parsed.host_str() else {
        return Err(
            Report::new(SourceError).attach_printable("egress blocked: configured URL has no host")
        );
    };

    if config::allow_private_hosts(env) {
        return Ok(());
    }

    let addresses: Vec<IpAddr> = if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        vec![ip]
    } else {
        tokio::net::lookup_host((host, parsed.port_or_known_default().unwrap_or(443)))
            .await
            .map(|addrs| addrs.map(|addr| addr.ip()).collect())
            .map_err(|_error| {
                Report::new(SourceError).attach_printable(format!(
                    "egress blocked: DNS resolution failed for host {host:?}"
                ))
            })?
    };

    if addresses.is_empty() {
        return Err(Report::new(SourceError).attach_printable(format!(
            "egress blocked: DNS resolution returned no addresses for host {host:?}"
        )));
    }

    if let Some(ip) = addresses.iter().find(|ip| private(ip)) {
        return Err(Report::new(SourceError).attach_printable(format!(
            "egress blocked: {host} resolves to the private/internal address {ip}; set INTEGRATIONS_ALLOW_PRIVATE_HOSTS=1 to allow (dev only)"
        )));
    }

    Ok(())
}

/// A diagnostic label that never contains credentials, path parameters,
/// query strings, or fragments from an interpolated integration URL.
pub fn safe_url_label(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            let host = parsed.host_str()?;
            let port = parsed
                .port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default();
            Some(format!("{}://{host}{port}", parsed.scheme()))
        })
        .unwrap_or_else(|| "configured URL".to_owned())
}

pub fn private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, _, _] = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                // Linux can route addresses in 0.0.0.0/8 to the local network stack.
                || a == 0
                || (a == 100 && (64..=127).contains(&b))
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return private(&IpAddr::V4(mapped));
            }
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || (0xfc00..=0xfdff).contains(&first)
                || (0xfe80..=0xfebf).contains(&first)
        }
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[tokio::test]
    async fn connection_resolution_rejects_private_addresses() {
        let server = wiremock::MockServer::start().await;
        let url = server.uri().replace("127.0.0.1", "localhost");
        let guarded = client(&env(&[])).expect("guarded client should build");
        assert!(
            guarded.get(&url).send().await.is_err(),
            "connection DNS should reject localhost without relying on URL preflight"
        );
        let local = client(&env(&[("INTEGRATIONS_ALLOW_PRIVATE_HOSTS", "1")]))
            .expect("local client should build");
        assert!(local.get(&url).send().await.is_ok());
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    fn env(pairs: &[(&str, &str)]) -> Env {
        Env::from_map(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect::<HashMap<_, _>>(),
        )
    }

    #[test]
    fn private_ranges() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "0.1.2.3",
            "0.255.255.255",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(private(&ip.parse().unwrap()), "{ip} should be private");
        }
        for ip in ["93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:2800::1"] {
            assert!(!private(&ip.parse().unwrap()), "{ip} should be public");
        }
    }

    #[tokio::test]
    async fn loopback_blocked_by_default_allowed_with_flag() {
        let err = validate_url("http://127.0.0.1:9200/x", &env(&[]))
            .await
            .unwrap_err();
        assert!(format!("{err:?}").contains("egress blocked"));

        validate_url(
            "http://127.0.0.1/x",
            &env(&[("INTEGRATIONS_ALLOW_PRIVATE_HOSTS", "1")]),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn non_http_schemes_blocked_regardless() {
        let allow = env(&[("INTEGRATIONS_ALLOW_PRIVATE_HOSTS", "1")]);
        for url in ["file:///etc/passwd", "ftp://example.com/x"] {
            let err = validate_url(url, &allow).await.unwrap_err();
            assert!(format!("{err:?}").contains("only http/https"), "{url}");
        }
    }
}
