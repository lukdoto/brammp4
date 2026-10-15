/// <reference types="vite/client" />

import type { BrammApi } from '../../shared/types'

declare global {
  interface Window {
    api: BrammApi
  }
}
