echo "******* Installing Rust *******"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
echo "******* Done installing Rust *******"

echo "******* Installing wasm-pack *******"
yarn global add wasm-pack
echo "******* Done installing wasm-pack *******"

echo "******* Installing yarn dependencies *******"
yarn
echo "******* Done installing dependencies *******"
