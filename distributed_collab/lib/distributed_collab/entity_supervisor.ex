defmodule DistributedCollab.EntitySupervisor do
  use DynamicSupervisor

  alias DistributedCollab.Entity
  alias Phoenix.PubSub

  def entities_group(), do: :entities

  def subscribe_to_entity_changes(entity_ids) do
    for entity_id <- entity_ids do
      case Swarm.whereis_name(entity_id) do
        :undefined ->
          start_child(entity_id)
          PubSub.subscribe(:pubsub, entity_id)

        _pid ->
          PubSub.subscribe(:pubsub, entity_id)
      end
    end
  end

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def start_child(entity_id) do
    # spec = {Entity, entity_id}
    # DynamicSupervisor.start_child(__MODULE__, spec)
    {:ok, pid} = Swarm.register_name(entity_id, __MODULE__, :register, [entity_id])
    Swarm.join(entities_group(), pid)
  end

  @impl true
  def init(init_arg) do
    DynamicSupervisor.init(
      strategy: :one_for_one,
      extra_arguments: [init_arg]
    )
  end

  def register(entity_id) do
    DynamicSupervisor.start_child(
      __MODULE__,
      {Entity, name: entity_id}
    )
  end
end
