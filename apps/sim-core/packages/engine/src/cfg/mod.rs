// Exports SimulationConfig

pub mod simulation;

pub use simulation::Config as SimulationConfig;

#[cfg(test)]
mod tests {
    use crate::prelude::Properties;
    use assert_approx_eq::assert_approx_eq;
    use hash_types::topology::WrappingBehavior;

    #[test]
    fn check_configs() {
        let properties = Properties::from_json_unchecked(json!({
            "topology":{
                "x_bounds": [0, 10],
                "y_bounds": [0, 10],
                "z_bounds": [0, 10],
                "search_radius": 10,
                "distance_function":"manhattan",
                "wrap_x_mode":"continuous",
            }
        }));
        let topo = properties.topology_config_unchecked();
        assert_approx_eq!(topo.search_radius.unwrap(), 10_f64);
        assert_approx_eq!(topo.x_bounds.max, 10_f64);
        assert_approx_eq!(topo.y_bounds.max, 10_f64);
        assert_approx_eq!(topo.z_bounds.max, 10_f64);
        assert_eq!(topo.wrap_x_mode, WrappingBehavior::Continuous);
        assert_eq!(topo.wrap_y_mode, WrappingBehavior::Reflection);
        assert_eq!(topo.wrap_z_mode, WrappingBehavior::Reflection);
    }
}
