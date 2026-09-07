//! Retries HTTP 429 responses from Graph writes and REST reads. An integer
//! `Retry-After` supplies the delay in seconds. Other values, including HTTP
//! dates, use exponential backoff. Each delay is capped at 30 seconds. After
//! ten retries, the caller receives the last response to handle as an error.

use std::future::Future;
use std::time::Duration;

const MAX_ATTEMPTS: u32 = 10;
const MAX_RETRY_AFTER_MS: u64 = 30_000;

pub async fn with_429_retry<F, Fut>(request: F) -> reqwest::Result<reqwest::Response>
where
    F: Fn() -> Fut,
    Fut: Future<Output = reqwest::Result<reqwest::Response>>,
{
    let mut attempt = 0;
    loop {
        let response = request().await?;
        if response.status().as_u16() != 429 || attempt >= MAX_ATTEMPTS {
            return Ok(response);
        }
        let delay = retry_after_ms(&response, attempt);
        // Release the response body/connection before sleeping so retry
        // backoff does not pin one pooled connection per throttled request.
        drop(response);
        tokio::time::sleep(Duration::from_millis(delay)).await;
        attempt += 1;
    }
}

pub fn retry_after_ms(response: &reqwest::Response, attempt: u32) -> u64 {
    response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(cap_seconds_ms)
        .unwrap_or_else(|| backoff_ms(attempt))
}

/// Saturation prevents server-supplied seconds from overflowing before the cap.
fn cap_seconds_ms(seconds: u64) -> u64 {
    seconds.saturating_mul(1000).min(MAX_RETRY_AFTER_MS)
}

pub fn backoff_ms(attempt: u32) -> u64 {
    (500u64 << attempt.min(16)).min(MAX_RETRY_AFTER_MS)
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

    #[test]
    fn retry_after_seconds_cap_never_overflows() {
        assert_eq!(cap_seconds_ms(5), 5_000);
        assert_eq!(cap_seconds_ms(60), MAX_RETRY_AFTER_MS);
        assert_eq!(
            cap_seconds_ms(u64::MAX),
            MAX_RETRY_AFTER_MS,
            "oversized Retry-After values should saturate before the cap"
        );
        assert_eq!(cap_seconds_ms(18_446_744_073_709_552), MAX_RETRY_AFTER_MS);
    }
}
