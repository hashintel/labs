use kdtree::KdtreePointTrait;

enum PointsWereOnSide {
    Left,
    Right,
    Both,
}

struct PartitionPointHelper {
    points_were_on_side: PointsWereOnSide,
    index_of_splitter: usize,
}

fn partition_sliding_midpoint_helper<T: KdtreePointTrait>(
    vec: &mut [T],
    midpoint_value: f64,
    partition_on_dimension: usize,
) -> PartitionPointHelper {
    const HAS_POINTS_ON_LEFT_SIDE: i32 = 0b01;
    const HAS_POINTS_ON_RIGHT_SIDE: i32 = 0b10;
    const HAS_POINTS_ON_BOTH_SIDES: i32 = HAS_POINTS_ON_RIGHT_SIDE | HAS_POINTS_ON_LEFT_SIDE;

    let mut closest_index = 0;
    let mut closest_distance = (vec[0].dims()[partition_on_dimension] - midpoint_value).abs();

    let mut has_points_on_sides = 0;

    for i in 0..vec.len() {
        let p = vec.get(i).unwrap();
        if p.dims()[partition_on_dimension] <= midpoint_value {
            has_points_on_sides |= HAS_POINTS_ON_LEFT_SIDE;
        } else {
            has_points_on_sides |= HAS_POINTS_ON_RIGHT_SIDE;
        }

        let dist = (p.dims()[partition_on_dimension] - midpoint_value).abs();

        if dist < closest_distance {
            closest_distance = dist;
            closest_index = i;
        }
    }

    if has_points_on_sides != HAS_POINTS_ON_BOTH_SIDES {
        return PartitionPointHelper {
            index_of_splitter: closest_index,
            points_were_on_side: if has_points_on_sides == HAS_POINTS_ON_LEFT_SIDE {
                PointsWereOnSide::Left
            } else {
                PointsWereOnSide::Right
            },
        };
    }

    PartitionPointHelper {
        index_of_splitter: closest_index,
        points_were_on_side: PointsWereOnSide::Both,
    }
}

#[allow(clippy::module_name_repetitions)]
pub fn partition_sliding_midpoint<T: KdtreePointTrait>(
    vec: &mut [T],
    midpoint_value: f64,
    partition_on_dimension: usize,
) -> usize {
    let vec_len = vec.len();
    debug_assert!(vec[0].dims().len() > partition_on_dimension);

    if vec.len() == 1 {
        return 0;
    }

    let partition_point_data =
        partition_sliding_midpoint_helper(vec, midpoint_value, partition_on_dimension);

    match partition_point_data.points_were_on_side {
        PointsWereOnSide::Left => {
            vec.swap(partition_point_data.index_of_splitter, vec_len - 1);
            vec_len - 1
        }
        PointsWereOnSide::Right => {
            vec.swap(partition_point_data.index_of_splitter, 0);
            0
        }
        PointsWereOnSide::Both => {
            // index of splitting point
            partition_kdtree(
                vec,
                partition_point_data.index_of_splitter,
                partition_on_dimension,
            )
        }
    }
}

fn partition_kdtree<T: KdtreePointTrait>(
    vec: &mut [T],
    index_of_splitting_point: usize,
    partition_on_dimension: usize,
) -> usize {
    if vec.len() == 1 {
        return 0;
    }

    let pivot = vec[index_of_splitting_point].dims()[partition_on_dimension];
    let vec_len = vec.len();

    vec.swap(index_of_splitting_point, vec_len - 1);

    let mut left = 0_usize;
    let mut right = vec.len() - 2;
    let mut last_succesful_swap = vec.len() - 1;

    //variant of Lomuto algo.
    loop {
        while left <= right && vec[left].dims()[partition_on_dimension] <= pivot {
            left += 1;
        }

        while right > left && vec[right].dims()[partition_on_dimension] > pivot {
            right -= 1;
        }

        if right > left {
            vec.swap(left, right);
            last_succesful_swap = right;

            left += 1;
            right -= 1;
        } else {
            break;
        }
    }

    if last_succesful_swap == vec_len - 1 && vec[right].dims()[partition_on_dimension] > pivot {
        vec.swap(right, last_succesful_swap);
        last_succesful_swap = right;
    } else if vec[left].dims()[partition_on_dimension] > pivot {
        vec.swap(left, vec_len - 1);
        last_succesful_swap = left;
    } else {
        vec.swap(last_succesful_swap, vec_len - 1);
    }

    last_succesful_swap
}

#[cfg(test)]
mod tests {
    use kdtree::test_common::{Point1WithId, Point2WithId};
    use kdtree::KdtreePointTrait;

    use rand::distributions::{IndependentSample, Range};
    use rand::thread_rng;

    use super::partition_kdtree;
    use super::*;

    #[test]
    fn parition_kdtree_works() {
        let p1 = Point2WithId::new(0, 1., 4.);
        let p2 = Point2WithId::new(1, 2., 6.);
        let p3 = Point2WithId::new(2, 3., 8.);
        let p4 = Point2WithId::new(3, 0., 8.);
        let p5 = Point2WithId::new(4, -1., 8.);
        let p6 = Point2WithId::new(5, 3., 8.);
        let p7 = Point2WithId::new(6, 4., 8.);

        let mut vec = vec![p1, p2, p3, p4, p5, p6, p7];
        assert_eq!(1, partition_kdtree(&mut vec.clone(), 3, 0));

        assert_eq!(6, partition_kdtree(&mut vec.clone(), 6, 0));

        assert_eq!(0, partition_kdtree(&mut vec.clone(), 4, 0));

        assert_eq!(5, partition_kdtree(&mut vec, 2, 0));
    }

    quickcheck! {
        fn partition_kdtree_qc(xs: Vec<f64>) -> bool {
            let mut vec : Vec<Point1WithId> = vec![];

            for i in 0 .. xs.len() {
                let p = Point1WithId::new(i as i32, xs[i]);
                vec.push(p);
            }

            if xs.is_empty() {
                return true;
            }
            let between = Range::new(0, xs.len());
            let mut rng = thread_rng();

            for _ in 0 .. 5 {
                let random_splitting_index = between.ind_sample(&mut rng);

                let mut vec = vec;

                let index_of_splitting_point = partition_kdtree(&mut vec, random_splitting_index, 0);
                return assert_partition(&vec, index_of_splitting_point);
            }

            true
        }
    }

    #[test]
    fn partition_given_midpoint_exactly_in_between_points_returns_smaller_index() {
        let p1 = Point2WithId::new(1, 2., 4.);
        let p2 = Point2WithId::new(1, 4., 6.);
        let mut vec = vec![p1, p2];

        assert_eq!(0, partition_sliding_midpoint(&mut vec, 3., 0));
        assert_eq!(0, partition_sliding_midpoint(&mut vec, 5., 1));
    }

    #[test]
    fn partition_given_midpoint_which_has_all_points_on_one_side_slides_split_plane_and_returns_index_to_closest_element(
    ) {
        let p1 = Point2WithId::new(1, 2., 4.);
        let p2 = Point2WithId::new(2, 4., 6.);
        let p3 = Point2WithId::new(3, 3., 7.);
        let p4 = Point2WithId::new(4, 0., 8.);
        let mut vec = vec![p1, p2, p3];

        assert_eq!(0, partition_sliding_midpoint(&mut vec, 1.9, 0));
        assert_eq!(1, vec[0].id);
        assert_eq!(2, vec[1].id);
        assert_eq!(3, vec[2].id);

        let mut vec = vec![p1, p2, p3];
        assert_eq!(0, partition_sliding_midpoint(&mut vec, -5000., 0));
        assert_eq!(1, vec[0].id);
        assert_eq!(2, vec[1].id);
        assert_eq!(3, vec[2].id);

        let mut vec = vec![p1, p2, p3];
        assert_eq!(2, partition_sliding_midpoint(&mut vec, 10., 0));
        assert_eq!(1, vec[0].id);
        assert_eq!(3, vec[1].id);
        assert_eq!(2, vec[2].id);

        let mut vec = vec![p1, p2, p3];
        assert_eq!(2, partition_sliding_midpoint(&mut vec, 10., 1));
        assert_eq!(1, vec[0].id);
        assert_eq!(2, vec[1].id);
        assert_eq!(3, vec[2].id);

        let mut vec = vec![p1, p2, p3, p4];
        assert_eq!(0, partition_sliding_midpoint(&mut vec, -5000., 0));
        assert_eq!(4, vec[0].id);
        assert_eq!(2, vec[1].id);
        assert_eq!(3, vec[2].id);
        assert_eq!(1, vec[3].id);
    }

    fn assert_partition(v: &Vec<Point1WithId>, index_of_splitting_point: usize) -> bool {
        let pivot = v[index_of_splitting_point].dims()[0];

        for i in 0..index_of_splitting_point {
            if v[i].dims()[0] > pivot {
                return false;
            }
        }

        for i in index_of_splitting_point + 1..v.len() {
            if v[i].dims()[0] < pivot {
                return false;
            }
        }

        true
    }
}
