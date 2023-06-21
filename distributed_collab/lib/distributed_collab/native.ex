defmodule CollabNative do
  use Rustler, otp_app: :distributed_collab, crate: "collab_native"

  @spec new_entity() :: reference
  def new_entity(), do: error()

  @spec entity_as_string(reference()) :: String.t()
  def entity_as_string(_ref), do: error()

  @spec apply_patch(reference(), String.t()) :: {} | {:error, atom()}
  def apply_patch(_ref, _patch), do: error()

  defp error(), do: :erlang.nif_error(:nif_not_loaded)
end
