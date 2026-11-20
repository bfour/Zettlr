import { StateEffect, StateField } from '@codemirror/state'
import type { QuartoSectionTarget } from '@common/quarto/section-references'

export const quartoSectionsUpdate = StateEffect.define<ReadonlyMap<string, QuartoSectionTarget>|undefined>()

export const quartoSectionsField = StateField.define<ReadonlyMap<string, QuartoSectionTarget>|undefined>({
  create: () => undefined,
  update (current, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(quartoSectionsUpdate)) {
        return effect.value
      }
    }
    return current
  }
})
