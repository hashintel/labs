#[must_use]
pub fn squared_euclidean(a: &[f64], b: &[f64]) -> f64 {
    debug_assert!(a.len() == b.len());

    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn squared_euclidean_test_1d() {
        let a = [2.];
        let b = [4.];
        let c = [-2.];

        assert_eq!(0., squared_euclidean(&a, &a));

        assert_eq!(4., squared_euclidean(&a, &b));

        assert_eq!(16., squared_euclidean(&a, &c));
    }

    #[test]
    fn squared_euclidean_test_2d() {
        let a = [2., 2.];
        let b = [4., 2.];
        let c = [4., 4.];

        assert_eq!(0., squared_euclidean(&a, &a));

        assert_eq!(4., squared_euclidean(&a, &b));

        assert_eq!(8., squared_euclidean(&a, &c));
    }
}
