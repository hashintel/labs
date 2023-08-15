defmodule DistributedCollab.MixProject do
  use Mix.Project

  def project do
    [
      app: :distributed_collab,
      version: "0.1.0",
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: {DistributedCollab.Application, []}
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:plug_cowboy, "~> 2.6"},
      {:plug, "~> 1.14"},
      {:jason, "~> 1.4"},
      {:phoenix_pubsub, "~> 2.1"},
      {:libcluster, "~> 3.3"},
      {:rustler, "~> 0.26.0"},
      {:swarm, "~> 3.4"}
    ]
  end
end
