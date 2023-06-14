defmodule DistributedCollab.Router do
  use Plug.Router

  plug(Plug.Static, at: "/", from: :distributed_collab)
  plug(:match)
  plug(:dispatch)

  match _ do
    send_resp(conn, 200, "Hello from plug")
  end
end
