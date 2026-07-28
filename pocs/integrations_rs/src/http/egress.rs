//! Egress policy for user-configurable fetch URLs (rest-api endpoints and
//! the next-link URLs their responses supply): http/https only, and the host
//! must not resolve to loopback, private, link-local, CGNAT, or unspecified
//! space unless INTEGRATIONS_ALLOW_PRIVATE_HOSTS is set (dev). Checked per
//! request, so every page of a paginated fetch revalidates whatever URL the
//! previous response handed back. The resolve-then-connect gap (DNS rebinding
//! between check and request) is accepted; the blast radius is bounded by
//! this check plus the graph's own auth.

use std::net::IpAddr;

use error_stack::Report;

use crate::config::{self, Env};
use crate::error::SourceError;

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
                // The whole 0.0.0.0/8 ("this network"), not just the
                // unspecified address: Linux routes 0.x.y.z to the local
                // stack, so the guard must block the entire block.
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
            // the whole 0.0.0.0/8, not just the unspecified address
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
