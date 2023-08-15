
alias DistributedCollab.{Entity, EntitySupervisor}

some_entity_id = "abc"
EntitySupervisor.subscribe_to_entity_changes([some_entity_id, "123", "def"])

Process.info(self(), :messages) |> IO.inspect()

Entity.apply_json_patch(some_entity_id, %Jsonpatch.Operation.Add{path: "/age", value: 33})
Entity.get_state(some_entity_id)
|> IO.inspect()

Process.info(self(), :messages) |> IO.inspect()
