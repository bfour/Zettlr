<template>
  <PopoverWrapper v-bind:target="props.target" v-on:close="emit('close')">
    <div
      ref="picker"
      class="highlight-picker"
      role="group"
      v-bind:aria-label="trans('Highlight color')"
      v-on:keydown.esc.prevent.stop="closeFromKeyboard"
    >
      <div class="highlight-colors">
        <button
          v-for="option in colors"
          v-bind:key="option.label"
          type="button"
          v-bind:aria-pressed="selectedColor === option.color"
          v-on:click="emit('select', option.color)"
        >
          <span
            class="highlight-swatch"
            v-bind:style="{ '--swatch-color': option.color ?? undefined }"
            aria-hidden="true"
          >
            <cds-icon v-if="selectedColor === option.color" shape="check"></cds-icon>
          </span>
          {{ option.label }}
        </button>
      </div>
      <button type="button" class="clear-highlight" v-on:click="emit('clear')">
        {{ trans('Clear highlight') }}
      </button>
    </div>
  </PopoverWrapper>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { trans } from '@common/i18n-renderer'
import PopoverWrapper from '@common/vue/PopoverWrapper.vue'

const props = defineProps<{
  target: HTMLElement
  color: string|null
}>()

const emit = defineEmits<{
  (e: 'select', color: string|null): void
  (e: 'clear'): void
  (e: 'close'): void
}>()

const selectedColor = computed(() => props.color?.toLowerCase() ?? null)
const picker = ref<HTMLElement|null>(null)

const colors = [
  { label: trans('Default'), color: null },
  { label: trans('Yellow'), color: '#ffcd3666' },
  { label: trans('Green'), color: '#65d68a66' },
  { label: trans('Blue'), color: '#67bfff66' },
  { label: trans('Pink'), color: '#ff83b466' },
  { label: trans('Purple'), color: '#ba9fff66' }
]

onMounted(() => {
  picker.value?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus()
})

function closeFromKeyboard (): void {
  emit('close')
  props.target.focus()
}
</script>

<style scoped>
.highlight-picker {
  --default-swatch-color: #ffff0080;
  padding: 2px;
}

body.dark .highlight-picker {
  --default-swatch-color: #ffff0060;
}

.highlight-colors {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
}

.highlight-picker button {
  border: 0;
  border-radius: 4px;
  padding: 4px 7px;
  text-align: start;
  font: inherit;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.highlight-colors button {
  display: flex;
  align-items: center;
  gap: 6px;
}

.highlight-picker button:hover,
.highlight-picker button[aria-pressed="true"] {
  background: color-mix(in srgb, currentColor 11%, transparent);
}

.highlight-picker button:focus-visible {
  outline: 2px solid var(--system-accent-color, currentColor);
  outline-offset: -2px;
}

.highlight-swatch {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  border-radius: 3px;
  background: var(--swatch-color, var(--default-swatch-color));
}

.highlight-swatch cds-icon {
  width: 14px;
  height: 14px;
}

.highlight-picker .clear-highlight {
  display: block;
  margin-block-start: 4px;
  width: 100%;
  border-block-start: 1px solid color-mix(in srgb, currentColor 24%, transparent);
}
</style>
