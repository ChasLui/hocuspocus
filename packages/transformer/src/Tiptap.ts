import type { Doc } from "yjs";
// @ts-ignore
import type { Extensions } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Transformer } from "./types.ts";
import { ProsemirrorTransformer } from "./Prosemirror.ts";

export class Tiptap implements Transformer {
	defaultExtensions: Extensions = [StarterKit];

	extensions(extensions: Extensions): Tiptap {
		this.defaultExtensions = extensions;

		return this;
	}

	fromYdoc(document: Doc, fieldName?: string | Array<string>): any {
		return ProsemirrorTransformer.fromYdoc(document, fieldName);
	}

	toYdoc(
		document: any,
		fieldName: string | Array<string> = "default",
		extensions?: Extensions,
	): Doc {
		return ProsemirrorTransformer.toYdoc(
			document,
			fieldName,
			getSchema(extensions || this.defaultExtensions),
		);
	}
}

export const TiptapTransformer = new Tiptap();
