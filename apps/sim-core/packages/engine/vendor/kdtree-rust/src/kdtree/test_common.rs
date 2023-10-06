use super::KdtreePointTrait;

#[derive(Copy, Clone, PartialEq)]
pub struct Point3WithId {
    dims: [f64; 3],
    pub id: i32,
}

impl Point3WithId {
    #[must_use]
    pub fn new(id: i32, x: f64, y: f64, z: f64) -> Point3WithId {
        Point3WithId {
            dims: [x, y, z],
            id,
        }
    }
}

impl KdtreePointTrait for Point3WithId {
    #[inline]
    fn dims(&self) -> &[f64] {
        &self.dims
    }
}

#[derive(Copy, Clone, PartialEq)]
pub struct Point2WithId {
    dims: [f64; 2],
    pub id: i32,
}

impl Point2WithId {
    #[must_use]
    pub fn new(id: i32, x: f64, y: f64) -> Point2WithId {
        Point2WithId { dims: [x, y], id }
    }
}

impl KdtreePointTrait for Point2WithId {
    #[inline]
    fn dims(&self) -> &[f64] {
        &self.dims
    }
}

#[derive(Copy, Clone, PartialEq)]
pub struct Point1WithId {
    dims: [f64; 1],
    pub id: i32,
}

impl Point1WithId {
    #[must_use]
    pub fn new(id: i32, x: f64) -> Point1WithId {
        Point1WithId { dims: [x], id }
    }
}

impl KdtreePointTrait for Point1WithId {
    #[inline]
    fn dims(&self) -> &[f64] {
        &self.dims
    }
}

#[must_use]
pub fn euclidean(a: &[f64], b: &[f64]) -> f64 {
    debug_assert!(a.len() == b.len());
    a.iter()
        .zip(b.iter())
        .map(|(x1, x2)| (*x1 - *x2).powi(2))
        .fold(0_f64, |acc, add| acc + add)
        .sqrt()
}
