defmodule DistributedCollab.Subgraph do
  require Logger

  alias DistributedCollab.{EntitySupervisor, Entity}

  def initialize_subscriptions(entity_ids) do
    EntitySupervisor.subscribe_to_entity_changes(entity_ids)

    for entity_id <- entity_ids do
      Entity.get_state(entity_id)
    end
  end
end
