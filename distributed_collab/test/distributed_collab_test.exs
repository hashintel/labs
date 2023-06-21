defmodule DistributedCollabTest do
  use ExUnit.Case
  doctest DistributedCollab

  test "greets the world" do
    assert DistributedCollab.hello() == :world
  end
end
