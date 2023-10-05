extern crate kdtree;
extern crate rand;

use rand::Rng;

use kdtree::kdtree::distance::squared_euclidean;
use kdtree::kdtree::test_common::{euclidean, Point3WithId};
use kdtree::kdtree::KdtreePointTrait;

fn gen_random() -> f64 {
    rand::thread_rng().gen_range(0., 10000.)
}

fn find_nn_with_linear_search(points: &Vec<Point3WithId>, find_for: Point3WithId) -> &Point3WithId {
    let distance_fun = kdtree::kdtree::distance::squared_euclidean;

    let mut best_found_distance = distance_fun(find_for.dims(), points[0].dims());
    let mut closed_found_point = &points[0];

    for p in points {
        let dist = distance_fun(find_for.dims(), p.dims());

        if dist < best_found_distance {
            best_found_distance = dist;
            closed_found_point = &p;
        }
    }

    closed_found_point
}

fn generate_points(point_count: usize) -> Vec<Point3WithId> {
    let mut points: Vec<Point3WithId> = vec![];

    for i in 0..point_count {
        points.push(Point3WithId::new(
            i as i32,
            gen_random(),
            gen_random(),
            gen_random(),
        ));
    }

    points
}

#[test]
fn test_against_1000_random_points() {
    let point_count = 1000_usize;
    let points = generate_points(point_count);
    kdtree::kdtree::test_common::Point1WithId::new(0, 0.);

    let tree = kdtree::kdtree::Kdtree::new(&mut points.clone());

    //test points pushed into the tree, id should be equal.
    for i in 0..point_count {
        let p = &points[i];

        assert_eq!(p.id, tree.nearest_search(p).id);
    }

    //test randomly generated points within the cube. and do the linear search. should match
    for _ in 0..500 {
        let p = Point3WithId::new(0_i32, gen_random(), gen_random(), gen_random());

        let found_by_linear_search = find_nn_with_linear_search(&points, p);
        let point_found_by_kdtree = tree.nearest_search(&p);

        assert_eq!(point_found_by_kdtree.id, found_by_linear_search.id);
    }
}

#[test]
fn test_incrementally_build_tree_against_built_at_once() {
    let point_count = 2000_usize;
    let mut points = generate_points(point_count);

    let tree_built_at_once = kdtree::kdtree::Kdtree::new(&mut points.clone());
    let mut tree_built_incrementally = kdtree::kdtree::Kdtree::new(&mut points[0..1]);

    for i in 1..point_count {
        let p = &points[i];

        tree_built_incrementally.insert_node(*p);
    }

    //test points pushed into the tree, id should be equal.
    for i in 0..point_count {
        let p = &points[i];

        assert_eq!(
            tree_built_at_once.nearest_search(p).id,
            tree_built_incrementally.nearest_search(p).id
        );
    }

    //test randomly generated points within the cube. and do the linear search. should match
    for _ in 0..5000 {
        let p = Point3WithId::new(0_i32, gen_random(), gen_random(), gen_random());
        assert_eq!(
            tree_built_at_once.nearest_search(&p).id,
            tree_built_incrementally.nearest_search(&p).id
        );
    }
}

#[test]
fn test_within_1000_random_points() {
    let point_count = 100_usize;

    // Query Point
    let p = Point3WithId::new(0_i32, 0.0, 0.0, 0.0);

    {
        // Build the points in the tree
        let mut points = Vec::new();
        for i in 0..point_count {
            points.push(Point3WithId::new(i as i32, i as f64, 0.0, 0.0));
        }
        let mykdtree = kdtree::kdtree::Kdtree::new(&mut points);

        // Linear mapping of points
        for i in 0..point_count {
            let found_points = mykdtree.within(&p, (i * i) as f64 + 0.1, squared_euclidean);
            assert_eq!(found_points.len(), i + 1);
        }
    }

    {
        let mut points = Vec::new();
        for i in 0..point_count {
            points.push(Point3WithId::new(i as i32, i as f64, i as f64, 0.0));
        }
        let mykdtree = kdtree::kdtree::Kdtree::new(&mut points);

        // flat diagonal mapping of points
        for i in 0..point_count {
            let found_points = mykdtree.within(&p, i as f64 * 2.0_f64.sqrt() + 0.1, euclidean);
            assert_eq!(found_points.len(), i + 1);
        }
    }

    {
        let mut points = Vec::new();
        for i in 0..point_count {
            points.push(Point3WithId::new(i as i32, i as f64, i as f64, i as f64));
        }
        let mykdtree = kdtree::kdtree::Kdtree::new(&mut points);

        // flat diagonal mapping of points
        for i in 0..point_count {
            let found_points = mykdtree.within(&p, i as f64 * 3.0_f64.sqrt() + 0.1, euclidean);
            assert_eq!(found_points.len(), i + 1);
        }
    }
}
