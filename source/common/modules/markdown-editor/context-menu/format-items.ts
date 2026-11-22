/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        getFormatSubmenu
 * CVM-Role:        Utility function
 * Maintainer:      benniekiss
 * License:         GNU GPL v3
 *
 * Description:     This function returns menu items for formatting commands
 *
 * END HEADER
 */

import { type EditorView } from '@codemirror/view'
import { trans } from '@common/i18n-renderer'
import { applyBold, applyComment, applyHighlight, applyItalic } from '../commands/markdown'
import { copyAsHTML, copyAsPlain, cut, paste, pasteAsPlain } from '../util/copy-paste-cut'
import { type AnyMenuItem } from '@common/modules/window-register/application-menu-helper'
import { getTransformSubmenu } from './transform-items'
import { getInsertSubmenu } from './insert-items'
import { getCustomShortcut } from '../keymaps/shortcuts'
import { configField } from '../util/configuration'
import { cmShortcutToElectron } from 'source/common/util/shortcuts'

export function getFormatMenuItems (view: EditorView): AnyMenuItem[] {
  const shortcuts = view.state.field(configField, false)?.shortcuts ?? []

  return [
    {
      label: trans('Bold'),
      accelerator: 'CmdOrCtrl+B',
      type: 'normal',
      action () { applyBold(view) }
    },
    {
      label: trans('Italic'),
      accelerator: 'CmdOrCtrl+I',
      type: 'normal',
      action () { applyItalic(view) }
    },
    {
      label: trans('Highlight'),
      accelerator: cmShortcutToElectron(getCustomShortcut('md-highlight', shortcuts)),
      type: 'normal',
      enabled: !view.state.readOnly,
      action () { applyHighlight(view) }
    },
    {
      label: trans('Insert comment'),
      accelerator: cmShortcutToElectron(getCustomShortcut('md-insert-comment', shortcuts)),
      type: 'normal',
      enabled: !view.state.readOnly,
      action () { applyComment(view) }
    },
    {
      label: trans('Cut'),
      accelerator: 'CmdOrCtrl+X',
      type: 'normal',
      action () { cut(view) }
    },
    {
      label: trans('Copy'),
      accelerator: 'CmdOrCtrl+C',
      type: 'normal',
      action () { copyAsPlain(view) }
    },
    {
      label: trans('Copy as HTML'),
      type: 'normal',
      action () { copyAsHTML(view) }
    },
    {
      label: trans('Paste'),
      accelerator: 'CmdOrCtrl+V',
      type: 'normal',
      action () { paste(view) }
    },
    {
      label: trans('Paste without style'),
      accelerator: 'CmdOrCtrl+Shift+V',
      type: 'normal',
      action () { pasteAsPlain(view) }
    },
    {
      type: 'separator'
    },
    {
      label: trans('Select all'),
      accelerator: 'CmdOrCtrl+A',
      type: 'normal',
      action () { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }) }
    },
    {
      type: 'separator'
    },
    getInsertSubmenu(view),
    getTransformSubmenu(view),
  ]
}
