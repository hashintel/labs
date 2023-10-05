use kdtree::KdtreePointTrait;

pub struct Bounds {
    pub bounds: [(f64, f64); 3],

    widest_dim: usize,
    midvalue_of_widest_dim: f64,
}

impl Bounds {
    pub fn new_from_points<T: KdtreePointTrait>(points: &[T]) -> Bounds {
        let mut bounds = Bounds {
            bounds: [(0., 0.), (0., 0.), (0., 0.)],
            widest_dim: 0,
            midvalue_of_widest_dim: 0.,
        };

        for i in 0..points[0].dims().len() {
            bounds.bounds[i].0 = points[0].dims()[i];
            bounds.bounds[i].1 = points[0].dims()[i];
        }

        for v in points.iter() {
            for dim in 0..v.dims().len() {
                bounds.bounds[dim].0 = bounds.bounds[dim].0.min(v.dims()[dim]);
                bounds.bounds[dim].1 = bounds.bounds[dim].1.max(v.dims()[dim]);
            }
        }

        bounds.calculate_variables();

        bounds
    }

    pub fn get_widest_dim(&self) -> usize {
        self.widest_dim
    }

    pub fn get_midvalue_of_widest_dim(&self) -> f64 {
        self.midvalue_of_widest_dim
    }

    pub fn clone_moving_max(&self, value: f64, dimension: usize) -> Bounds {
        let mut cloned = Bounds {
            bounds: self.bounds,
            ..*self
        };
        cloned.bounds[dimension].1 = value;

        cloned.calculate_variables();

        cloned
    }

    pub fn clone_moving_min(&self, value: f64, dimension: usize) -> Bounds {
        let mut cloned = Bounds {
            bounds: self.bounds,
            ..*self
        };
        cloned.bounds[dimension].0 = value;

        cloned.calculate_variables();

        cloned
    }

    fn calculate_widest_dim(&mut self) {
        let mut widest_dimension = 0_usize;
        let mut max_found_spread = self.bounds[0].1 - self.bounds[0].0;

        for i in 0..self.bounds.len() {
            let dimension_spread = self.bounds[i].1 - self.bounds[i].0;

            if dimension_spread > max_found_spread {
                max_found_spread = dimension_spread;
                widest_dimension = i;
            }
        }

        self.widest_dim = widest_dimension;
    }

    fn calculate_variables(&mut self) {
        self.calculate_widest_dim();
        self.midvalue_of_widest_dim =
            (self.bounds[self.get_widest_dim()].0 + self.bounds[self.get_widest_dim()].1) / 2.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kdtree::test_common::Point2WithId;

    #[test]
    fn bounds_test() {
        let p1 = Point2WithId::new(1, 1.0, 0.5);
        let p2 = Point2WithId::new(1, 3.0, 4.0);
        let v = vec![p1, p2];

        let bounds = Bounds::new_from_points(&v);

        assert_eq!((1., 3.0), bounds.bounds[0]);
        assert_eq!((0.5, 4.0), bounds.bounds[1]);

        assert_eq!(1, bounds.get_widest_dim());
    }
}
