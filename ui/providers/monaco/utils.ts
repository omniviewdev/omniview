import * as monaco from 'monaco-editor';

export type RegisterModelOpts = {
  /** The gvr key of the resource */
  key: string;
  /** The ID of the resource itself */
  id: string;
  /** The data being put into the editor */
  data?: string;
};

/**
 * Register a model with the editor, returning if it already exists
 */
export const registerModel = (opts: RegisterModelOpts) => {
  const uri = monaco.Uri.parse(`file:///${opts.key}/${opts.id}.yaml`);
  if (monaco.editor.getModel(uri)) {
    return;
  }

  monaco.editor.createModel(
    opts.data ?? '',
    undefined,
    monaco.Uri.parse(`file:///${opts.key}/${opts.id}.yaml`)
  );
};

/**
 * Dispose of a model in the editor. Should be called in cleanup
 */
export const disposeModel = (opts: RegisterModelOpts) => {
  const model = monaco.editor.getModel(
    monaco.Uri.parse(`file:///${opts.key}/${opts.id}.yaml`)
  );
  if (model) {
    model.dispose();
  }
};
