defmodule DistributedCollab.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  alias DistributedCollab.{Router, EntitySupervisor, SocketHandler, Entity}

  require Logger

  use Application

  defp dispatch_http do
    [
      {:_,
       [
         {"/ws", SocketHandler, []},
         {:_, Plug.Cowboy.Handler, {Router, []}}
       ]}
    ]
  end

  @impl true
  def start(_type, _args) do
    web_port_num = String.to_integer(System.get_env("PORT", "4000"))
    Logger.info("Started server on port #{web_port_num}")

    topologies = [
      epmd: [
        strategy: Cluster.Strategy.Epmd,
        config: [hosts: [:"a@127.0.0.1", :"b@127.0.0.1"]]
      ]
      # goss: [
      #   strategy: Cluster.Strategy.Gossip
      # ]
    ]

    children = [
      {Cluster.Supervisor, [topologies, [name: DistributedCollab.ClusterSupervisor]]},
      {Plug.Cowboy,
       scheme: :http,
       plug: Router,
       options: [
         port: web_port_num,
         protocol_options: [idle_timeout: :infinity],
         dispatch: dispatch_http()
       ]},
      {Registry, [keys: :unique, name: Entity.registry()]},
      {EntitySupervisor, []},
      {Phoenix.PubSub, name: :pubsub}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: DistributedCollab.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
