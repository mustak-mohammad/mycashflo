import type { RazorpayConstructor } from '../types'

export const RAZORPAY_CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let razorpayScriptPromise: Promise<RazorpayConstructor> | null = null

/**
 * Dynamically loads the official Razorpay Standard Checkout SDK (checkout.js).
 * Uses a singleton promise and deduplicates script tags to prevent multiple network requests.
 */
export function loadRazorpayCheckoutScript(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay Checkout can only be loaded in a browser environment.'))
  }

  // If already loaded on window, resolve immediately
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay)
  }

  // If an existing load request is already pending, reuse it
  if (razorpayScriptPromise) {
    return razorpayScriptPromise
  }

  razorpayScriptPromise = new Promise<RazorpayConstructor>((resolve, reject) => {
    // Check if script element was already injected into DOM
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_CHECKOUT_SCRIPT_URL}"]`,
    )

    if (!script) {
      script = document.createElement('script')
      script.src = RAZORPAY_CHECKOUT_SCRIPT_URL
      script.async = true
      script.crossOrigin = 'anonymous'
      document.body.appendChild(script)
    }

    const handleLoad = () => {
      cleanupListeners()
      if (window.Razorpay) {
        resolve(window.Razorpay)
      } else {
        razorpayScriptPromise = null
        reject(new Error('Razorpay SDK script loaded, but window.Razorpay was not found.'))
      }
    }

    const handleError = () => {
      cleanupListeners()
      razorpayScriptPromise = null
      reject(
        new Error(
          'Failed to load Razorpay Checkout SDK. Please check your internet connection and try again.',
        ),
      )
    }

    const cleanupListeners = () => {
      script?.removeEventListener('load', handleLoad)
      script?.removeEventListener('error', handleError)
    }

    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)
  })

  return razorpayScriptPromise
}

/**
 * Resets the cached script loading promise for test isolation.
 */
export function resetRazorpayLoaderForTests(): void {
  razorpayScriptPromise = null
}

