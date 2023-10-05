import { InitContext, InitFn, Json } from "./types";

export class JsInitializer {
  public name: string;

  private inner: InitFn;
  private properties: Json;
  private datasets: Json;

  constructor(name: string, init: InitFn, properties: Json, datasets: Json) {
    this.name = name;
    this.inner = init;
    this.properties = properties;
    this.datasets = datasets;
  }

  public apply() {
    const context: InitContext = {
      globals: () => this.properties,
      data: () => this.datasets,
    };
    return this.inner(context);
  }

  public updateProperties(props: Json) {
    this.properties = props;
  }
}
