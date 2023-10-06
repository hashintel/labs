# kdtree-rust [![Build Status](https://travis-ci.org/fulara/kdtree-rust.svg?branch=develop)](https://travis-ci.org/fulara/kdtree-rust) [![Build Status](https://img.shields.io/crates/v/fux_kdtree.svg?branch=develop)](https://crates.io/crates/fux_kdtree)
kdtree implementation for rust.

Implementation uses sliding midpoint variation of the tree. [More Info here](http://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.74.210&rep=rep1&type=pdf) 
Implementation uses single `Vec<Node>` to store all its contents, allowing for quick access, and no memory fragmentation.

###Usage
Tree can only be used with types implementing trait:
```
pub trait KdtreePointTrait : Copy  {
    fn dims(&self) -> &[f64];
}
```

Thanks to this trait you can use any dimension. Keep in mind that the tree currently only supports up to 3D [#2](/../../issues/2).  
Examplary implementation would be:
```
pub struct Point3WithId {
    dims: [f64; 3],
    pub id: i32,
}

impl KdtreePointTrait for Point3WithId {
    #[inline] // the inline on this method is important! as without it there is ~25% speed loss on the tree when cross-crate usage.
    fn dims(&self) -> &[f64] {
        return &self.dims;
    }
}
```
Where id is just a example of the way in which I carry the data.  
With that trait implemented you are good to go to use the tree. Keep in mind that the kdtree is not a self balancing tree, It does support adding the nodes with method 'insert_node' and there is indeed a code to rebuild the tree if depths grows substantially. Basic usage can be found in the integration test, fragment copied below:
```
let tree = kdtree::kdtree::Kdtree::new(&mut points.clone());

//test points pushed into the tree, id should be equal.
for i in 0 .. point_count {
    let p = &points[i];

    assert_eq!(p.id, tree.nearest_search(p).id );
}
```
Although not recommended for the kd-tree you can use the `insert_node` and `insert_nodes_and_rebuild` functions to add nodes to the tree. `insert_node` does silly check to check whether the tree should be rebuilt. `insert_nodes_and_rebuild` Automatically rebuilds the tree.  

for now the removal of the nodes is not supported.

##Benchmark
`cargo bench` using travis :)
```
running 3 tests
test bench_creating_1000_000_node_tree          ... bench: 275,155,622 ns/iter (+/- 32,713,321)
test bench_adding_same_node_to_1000_tree        ... bench:          42 ns/iter (+/- 11)
test bench_creating_1000_node_tree              ... bench:     120,310 ns/iter (+/- 4,746)
test bench_single_lookup_times_for_1000_node_tree ... bench:         164 ns/iter (+/- 139)
test result: ok. 0 passed; 0 failed; 0 ignored; 4 measured
```

~275ms to create a 1000_000 node tree. << this bench is now disabled.  
~120us to create a 1000 node tree.  
160ns to query the tree.  

###Benchmark - comparison with CGAL.
Since raw values arent saying much I've created the benchmark comparing this implementation against CGAL. code of the benchmark is available here: https://github.com/fulara/kdtree-benchmarks
```
Benchmark                           Time           CPU Iterations
-----------------------------------------------------------------
Cgal_tree_buildup/10             2226 ns       2221 ns     313336
Cgal_tree_buildup/100           18357 ns      18315 ns      37968
Cgal_tree_buildup/1000         288135 ns     287345 ns       2369
Cgal_tree_buildup/9.76562k    3296740 ns    3290815 ns        211
Cgal_tree_buildup/97.6562k   42909150 ns   42813307 ns         12
Cgal_tree_buildup/976.562k  734566227 ns  733267760 ns          1
Cgal_tree_lookup/10                72 ns         72 ns    9392612
Cgal_tree_lookup/100               95 ns         95 ns    7103628
Cgal_tree_lookup/1000             174 ns        174 ns    4010773
Cgal_tree_lookup/9.76562k         268 ns        267 ns    2759487
Cgal_tree_lookup/97.6562k         881 ns        876 ns    1262454
Cgal_tree_lookup/976.562k         993 ns        991 ns     713751
Rust_tree_buildup/10              726 ns        724 ns     856791
Rust_tree_buildup/100            7103 ns       7092 ns      96132
Rust_tree_buildup/1000          84879 ns      84720 ns       7927
Rust_tree_buildup/9.76562k    1012983 ns    1010856 ns        630
Rust_tree_buildup/97.6562k   12406293 ns   12382399 ns         51
Rust_tree_buildup/976.562k  197175067 ns  196763387 ns          3
Rust_tree_lookup/10                62 ns         62 ns   11541505
Rust_tree_lookup/100              139 ns        139 ns    4058837
Rust_tree_lookup/1000             220 ns        220 ns    2890813
Rust_tree_lookup/9.76562k         307 ns        307 ns    2508133
Rust_tree_lookup/97.6562k         362 ns        362 ns    2035671
Rust_tree_lookup/976.562k         442 ns        441 ns    1636130
```  
Rust_tree_lookup has some overhead since the libraries are being invoked from C code into Rust, and there is minor overhead of that in between, my experience indicates around 50 ns overhead.

##License
The Unlicense
