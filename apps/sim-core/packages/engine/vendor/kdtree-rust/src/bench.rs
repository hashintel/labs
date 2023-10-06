#[macro_use]
extern crate bencher;
extern crate kdtree;
extern crate rand;

use bencher::Bencher;
use rand::Rng;

use kdtree::kdtree::distance::squared_euclidean;
use kdtree::kdtree::test_common::Point3WithId;

fn gen_random() -> f64 {
    rand::thread_rng().gen_range(0., 10_000.)
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

fn bench_creating_1000_node_tree(b: &mut Bencher) {
    let len = 1000_usize;
    let points = generate_points(len);

    b.iter(|| {
        kdtree::kdtree::Kdtree::new(&mut points.clone());
    });
}

fn bench_single_loop_times_for_1000_node_tree(b: &mut Bencher) {
    let len = 1000_usize;
    let points = generate_points(len);

    let tree = kdtree::kdtree::Kdtree::new(&mut points.clone());

    b.iter(|| tree.nearest_search(&points[0]));
}

fn bench_single_loop_times_for_1000_node_tree_within(b: &mut Bencher) {
    let len = 1000_usize;
    let points = generate_points(len);

    let tree = kdtree::kdtree::Kdtree::new(&mut points.clone());

    b.iter(|| tree.within(&points[0], 5000.0, squared_euclidean));
}

#[allow(dead_code)]
fn bench_creating_1000_000_node_tree(b: &mut Bencher) {
    let len = 1_000_000_usize;
    let points = generate_points(len);

    b.iter(|| {
        kdtree::kdtree::Kdtree::new(&mut points.clone());
    });
}

fn bench_adding_same_node_to_1000_tree(b: &mut Bencher) {
    let len = 1000_usize;
    let mut points = generate_points(len);
    let mut tree = kdtree::kdtree::Kdtree::new(&mut points);

    let point = Point3WithId::new(-1 as i32, gen_random(), gen_random(), gen_random());
    b.iter(|| {
        tree.insert_node(point);
    });
}

fn bench_incrementally_building_the_1000_tree(b: &mut Bencher) {
    b.iter(|| {
        let len = 1_usize;
        let mut points = generate_points(len);
        let mut tree = kdtree::kdtree::Kdtree::new(&mut points);
        for _ in 0..1000 {
            let point = Point3WithId::new(-1 as i32, gen_random(), gen_random(), gen_random());
            tree.insert_node(point);
        }
    });
}

benchmark_group!(
    benches,
    bench_creating_1000_node_tree,
    bench_single_loop_times_for_1000_node_tree,
    bench_adding_same_node_to_1000_tree,
    bench_incrementally_building_the_1000_tree,
    bench_single_loop_times_for_1000_node_tree_within
);
benchmark_main!(benches);
