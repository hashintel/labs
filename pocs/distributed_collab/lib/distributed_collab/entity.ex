defmodule DistributedCollab.Entity do
  use GenServer
  require Logger

  alias Phoenix.PubSub

  def registry(), do: :entity_registry

  ## GenServer API
  def get_state(process_name) do
    cast_worker(process_name, {:send_state, self()})
  end

  def apply_json_patch(process_name, raw_message) do
    cast_worker(process_name, {:apply_update, self(), raw_message})
  end

  def stop(process_name, stop_reason) do
    process_name |> get_worker() |> GenServer.stop(stop_reason)
  end

  def start_link(_, name) do
    GenServer.start_link(__MODULE__, name)
  end

  def get_worker(name), do: Swarm.whereis_name(name)

  defp call_worker(name, msg), do: GenServer.call({:via, :swarm, name}, msg)

  defp cast_worker(name, msg), do: GenServer.cast({:via, :swarm, name}, msg)

  # @doc """
  # Called by the supervisor to retrieve specification of the child process.
  # The child process is configured to restart only if it terminates abnormally.
  # """
  # def child_spec(process_name) do
  #   %{
  #     id: __MODULE__,
  #     start: {__MODULE__, :start_link, [process_name]},
  #     # the GenServer will restart if any reason other than `:normal` is given.
  #     restart: :transient
  #   }
  # end

  # Server callbacks
  @impl true
  def init([{:name, entity_id}]) do
    Logger.info("Starting process #{entity_id}")
    {:ok, %{json: CollabNative.new_entity(), entity_id: entity_id}}
  end

  def handle_call({:swarm, :begin_handoff}, _from, _info) do
    :restart
  end

  def handle_cast({:swarm, :resolve_conflict, _delay}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_cast({:send_state, destination_pid}, state) do
    send(
      destination_pid,
      {:current_state, state[:entity_id], CollabNative.entity_as_string(state[:json])}
    )

    {:noreply, state}
  end

  @impl true
  def handle_cast(
        {:apply_update, pid, raw_message},
        state
      ) do
    new_state =
      Map.update!(state, :json, fn current_state ->
        case CollabNative.apply_patch(current_state, raw_message) do
          {} ->
            entity_id = state[:entity_id]

            PubSub.broadcast_from!(
              :pubsub,
              pid,
              entity_id,
              {:publish, raw_message}
            )

            current_state

          {:error, val} ->
            Logger.info("Got patch apply error #{inspect(val)}")

            current_state
        end
      end)

    {:noreply, new_state}
  end
end
