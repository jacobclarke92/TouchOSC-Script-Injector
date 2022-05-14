export type Property<TypeStr extends string, ValueType extends unknown> = {
  ['@type']: TypeStr
  key: string
  value: ValueType
}

export type BooleanProperty = Property<'b', 1 | 0>
export type StringProperty = Property<'s', string>
export type IntegerProperty = Property<'i', number>
export type FloatProperty = Property<'f', number>
export type ColorProperty = Property<'c', { r: number; g: number; b: number; a: number }>
export type FrameProperty = Property<'f', { x: number; y: number; w: number; h: number }>

export type ToscProperty =
  | BooleanProperty
  | StringProperty
  | IntegerProperty
  | FloatProperty
  | ColorProperty
  | FrameProperty

export type ToscValue<ValueType = unknown> = {
  key: string
  locked: 0 | 1
  lockedDefaultCurrent: 0 | 1
  default: ValueType
  defaultPull?: number
}

export interface ToscNode {
  ['@ID']: string
  ['@type']:
    | 'BOX'
    | 'BUTTON'
    | 'LABEL'
    | 'TEXT'
    | 'FADER'
    | 'XY'
    | 'RADIAL'
    | 'ENCODER'
    | 'RADAR'
    | 'RADIO'
    | 'GROUP'
    | 'PAGER'
    | 'GRID'
  properties: { property: ToscProperty[] }
  values: {
    value: ToscValue | ToscValue[]
  }
}

export interface ToscGroupNode extends ToscNode {
  children: { node: (ToscNode | ToscGroupNode)[] }
}

export interface ToscDoc {
  xml: {
    ['@version']: string
    ['@encoding']: string
  }
  lexml: {
    ['@version']: string
    node: ToscGroupNode
  }
}
