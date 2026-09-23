import {ref, watch} from 'vue'
import {safeRead, safeWrite} from './browser'
export const reducedMotion = ref(safeRead('poker-chips-reduced-motion') === '1')
export const highContrast = ref(safeRead('poker-chips-high-contrast') === '1')
if (typeof document !== 'undefined') {
  watch(reducedMotion, value => { document.documentElement.classList.toggle('reduce-motion', value); safeWrite('poker-chips-reduced-motion', value ? '1' : '0') }, {immediate: true})
  watch(highContrast, value => { document.documentElement.classList.toggle('high-contrast', value); safeWrite('poker-chips-high-contrast', value ? '1' : '0') }, {immediate: true})
}
