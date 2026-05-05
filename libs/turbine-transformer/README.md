# `turbine-transformer`

> Origin of the name: A wind turbine uses wind to generate electricity through rotation. The transformer is used to
> transform the voltage. This project aims to take the input from the turbine and transform it, by applying a set of
> instructions.


The goal of the project is to supplement the HASH REST-APIs query abilities with a more powerful query language. This
has some trade-offs, you will still need to load in all entities from HASH, but you can then filter them down to the
ones you want.

This is _very_ early in development, and is not ready for production use. Tests are missing, and the API is not stable.
Especially the names of the different types are likely to change. Do not expect this to be usable in production, over
the next weeks and months I will be working on this project to make it more stable and usable.

## Examples

```rust
use turbine_transformer::View;

fn main() {
    let view = View::new(&mut subgraph.entities);
    let always_include = /* entity id */;

    view.select(vec![
        Statement::type_()
            .or_id(always_include)
            .or_type::<User>()
            .or_type::<Post>()
            .or_inherits_from::<Person>()
            .and(
                PropertyMatch::equals(
                    JsonPath::new().then::<Name>(),
                    "John Doe"
                )
            )
            .with_links()
            .with_left(
                TypeMatch::new()
                    .or_type::<User>()
                    .or_type::<Post>()
            )
            .with_right(
                TypeMatch::new()
                    .or_type::<User>()
                    .or_type::<Post>()
            )
    ]);

    // You can also update selected entities
    view.select_properties(vec![
        Select::new(TypeMatch::new().or_type::<User>(), Action::Exclude)
            .do_(StaticAction::new::<Name>())
            .do_(StaticAction::new::<Email>())
            .do_(StaticAction::new::<Password>())
    ]);

    // ... or change the value of specific properties
    view.update_properties(vec![
        Update::new(TypeMatch::new().or_type::<User>())
            .do_(StaticUpdate::new::<Name>("John Doe"))
    ]);

    // or remap a specific user name to a different value
    view.update_properties(vec![
        Update::new(TypeMatch::new().or_type::<User>().or(
            PropertyMatch::equals(
                JsonPath::new().then::<Name>(),
                "John Doe"
            )
        ))
            .do_(StaticUpdate::new::<Name>("Doe John"))
    ]);
}
```

## Credit

Developed by [Bilal Mahmoud](https://github.com/indietyp).
