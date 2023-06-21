defmodule DistributedCollab.SocketHandler do
  @behaviour :cowboy_websocket

  require Logger

  alias DistributedCollab.{Entity, Subgraph}

  @initial_state %{subscriptions: []}

  @impl true
  def init(req, state) do
    {:cowboy_websocket, req, state}
  end

  @impl true
  def websocket_init(_state) do
    {:ok, @initial_state}
  end

  @impl true
  def websocket_handle({:text, raw_message}, state) do
    case Jason.decode(raw_message) do
      {:ok, json} -> websocket_handle({:json, json, raw_message}, state)
      _ -> {:reply, {:text, respond_with_status("ok")}, state}
    end
  end

  def websocket_handle({:json, %{"subscribe_to" => entity_ids}, _}, state)
      when is_list(entity_ids) do
    add_subscription(entity_ids)

    {:reply, {:text, respond_with_status("ok")}, state}
  end

  def websocket_handle(
        {:json, %{"entity_id" => entity_id, "patch" => _}, raw_message},
        state
      )
      when is_binary(entity_id) do
    Entity.apply_json_patch(entity_id, raw_message)

    {:reply, {:text, respond_with_status("ok")}, state}
  end

  def websocket_handle({:json, data}, state) do
    Logger.info("Unhandled #{inspect(data)}")
    {:reply, {:text, "Unhandled."}, state}
  end

  @impl true
  def websocket_info({:publish, published}, state) do
    IO.inspect(published)
    {:reply, {:text, ~s({"status": "update", "payload": #{published}})}, state}
    # {:ok, state}
  end

  @impl true
  def websocket_info({:current_state, entity_id, entity_state}, state) do
    {:reply,
     {:text,
      ~s({"status": "current_state", "entity_id": "#{entity_id}", "payload": #{entity_state}})},
     state}
  end

  @impl true
  def websocket_info(unhandled, state) do
    Logger.info("Unhandled #{inspect(unhandled)}")
    {:ok, state}
  end

  @impl true
  def terminate(_reason, _req, _state) do
    :ok
  end

  def respond_with_status(status, data \\ %{}) do
    Map.merge(%{"status" => status}, data)
    |> Jason.encode!()
  end

  # State management
  def add_subscription(entity_ids) do
    Subgraph.initialize_subscriptions(entity_ids)
  end
end
