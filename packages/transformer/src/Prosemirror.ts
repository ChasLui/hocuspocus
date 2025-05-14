import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs'
// @ts-ignore
import { yDocToProsemirrorJSON, prosemirrorJSONToYDoc } from 'y-prosemirror'
import { Schema } from '@tiptap/pm/model'
import type { Transformer } from './types.ts'

class Prosemirror implements Transformer {

  defaultSchema: Schema = new Schema({
    nodes: {
      text: {},
      doc: { content: 'text*' },
    },
  })

  schema(schema: Schema): Prosemirror {
    this.defaultSchema = schema

    return this
  }

  fromYdoc(document: Doc, fieldName?: string | Array<string>): any {
    const data = {}

    // 允许单个字段名
    if (typeof fieldName === 'string') {
      return yDocToProsemirrorJSON(document, fieldName)
    }

    // 如果给定的字段名是空，则默认使用所有可用的字段
    if (fieldName === undefined || fieldName.length === 0) {
      fieldName = Array.from(document.share.keys())
    }

    fieldName.forEach(field => {
      // @ts-ignore
      data[field] = yDocToProsemirrorJSON(document, field)
    })

    return data
  }

  toYdoc(document: any, fieldName: string | Array<string> = 'prosemirror', schema?: Schema): Doc {
    if (!document) {
      throw new Error(`You’ve passed an empty or invalid document to the Transformer. Make sure to pass ProseMirror-compatible JSON. Actually passed JSON: ${document}`)
    }

    // 允许单个字段名
    if (typeof fieldName === 'string') {
      return prosemirrorJSONToYDoc(schema || this.defaultSchema, document, fieldName)
    }

    const ydoc = new Doc()

    fieldName.forEach(field => {
      const update = encodeStateAsUpdate(
        prosemirrorJSONToYDoc(schema || this.defaultSchema, document, field),
      )

      applyUpdate(ydoc, update)
    })

    return ydoc
  }

}

export const ProsemirrorTransformer = new Prosemirror()
