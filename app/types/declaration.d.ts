declare module "*.svg" {
  import React from "react"
  import { SvgProps } from "react-native-svg"
  const content: React.FC<SvgProps>
  export default content
}

declare module "*.png" {
  import { ImageSourcePropType } from "react-native"
  const content: ImageSourcePropType
  export default content
}

declare module "*.gif" {
  const content: number
  export default content
}

declare module "*.json" {
  const content: string
  export default content
}

// The `text-encoding` polyfill ships no types. It exposes the standard Web API constructors,
// installed as Hermes globals in app/polyfills/text-encoding.ts.
declare module "text-encoding" {
  export class TextEncoder {
    encode(input?: string): Uint8Array
    readonly encoding: string
  }
  export class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean })
    decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string
    readonly encoding: string
  }
}
