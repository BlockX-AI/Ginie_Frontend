"use client";

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { ArrowUp, Loader2 } from 'lucide-react'
import ReferenceSection from './ReferenceSection'

const HERO_IMG = 'https://framerusercontent.com/images/9zvwRJAavKKacVyhFCwHyXW1U.png?width=1536&height=1024'

export default function Hero() {
  const ref = useRef<HTMLElement | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  // sticky hero container
  const stickyRef = useRef<HTMLDivElement | null>(null)
  // container that holds the image so we can scale it on scroll
  const imageWrapRef = useRef<HTMLDivElement | null>(null)
  // refs for corner hands
  const handTopRef = useRef<HTMLImageElement | null>(null)
  const handBottomRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const imageEl = imageWrapRef.current
    if (!imageEl) return

    let ticking = false

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY || window.pageYOffset
          const vh = window.innerHeight || document.documentElement.clientHeight

          // progress 0..1 while scrolling from top to one viewport height
          const progress = Math.min(Math.max(scrollY / vh, 0), 1)

          // scale from 1 -> 0.94 and translate up slightly
          const scale = 1 - progress * 0.06
          const translateY = -progress * 18 // px

          // apply transform
          imageEl.style.transform = `scale(${scale}) translateY(${translateY}px)`
          imageEl.style.willChange = 'transform'

          // subtle dimming as it shrinks
          const overlay = imageEl.querySelector('.hero-dimmer') as HTMLDivElement | null
          if (overlay) overlay.style.opacity = `${0.0 + progress * 0.15}`

          ticking = false
        })
        ticking = true
      }
    }

    // initial frame
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    setIsLoading(true)
    setError('')

    try {
      const result: any = await api.startPipeline({
        prompt: trimmed,
        model: 'gpt-4o',
      })
      const dappId = result?.chat_id || result?.job?.id || result?.id
      if (dappId) {
        setInput('')
        router.push(`/chat/${encodeURIComponent(dappId)}?mode=dapp`)
      } else {
        throw new Error('Failed to start DApp creation')
      }
    } catch (err: any) {
      setError(err?.message || 'Request failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <section ref={ref} className="relative min-h-screen bg-black p-0">
        {/* Fixed full-viewport container — other sections will scroll above this */}
        <div ref={stickyRef} className="fixed inset-0 h-screen pointer-events-none z-0">
          {/* image wrapper fills the viewport, positioned with some horizontal padding */}
          <div ref={imageWrapRef} className="absolute left-6 right-6 sm:left-12 sm:right-12 md:left-16 md:right-16 lg:left-20 lg:right-20 top-8 md:top-12 lg:top-8 bottom-4 sm:bottom-6 md:bottom-8 lg:bottom-8 rounded-[15px] overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,0.65)] transform-gpu transition-transform duration-150 z-0">
            <img
              src={HERO_IMG}
              alt="Hero"
              className="w-full h-full object-cover"
            />
            {/* subtle overlay to allow dimming on scroll */}
            <div className="hero-dimmer absolute inset-0 bg-black pointer-events-none opacity-0 transition-opacity duration-150" />
            {/* grainy film overlay above the image (not over the hands/text) */}
            <div className="hero-grain absolute inset-0 pointer-events-none" />

            {/* Corner hands */}
            <img
              ref={handTopRef}
              src="https://framerusercontent.com/images/KNhiA5A2ykNYqNkj04Hk6BVg5A.png?scale-down-to=1024&width=1540&height=1320"
              alt="hand-top-left"
              className="pointer-events-none absolute -top-4 -left-8 w-40 sm:w-48 md:w-[360px] lg:w-[480px] opacity-95"
            />
            <img
              ref={handBottomRef}
              src="https://framerusercontent.com/images/X89VFCABCEjjZ4oLGa3PjbOmsA.png?scale-down-to=1024&width=1542&height=1002"
              alt="hand-bottom-right"
              className="pointer-events-none absolute -bottom-4 -right-8 w-40 sm:w-48 md:w-[360px] lg:w-[480px] opacity-95"
            />

            {/* Overlay heading centered to the viewport */}
            <div className="fixed inset-0 z-10 flex flex-col items-center justify-center pointer-events-none px-6">
              <h1 className="font-playfair text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-normal text-white/95 text-center leading-tight tracking-tight drop-shadow-sm [text-shadow:_0_0_24px_rgba(255,255,255,0.18)]">
                <span className="block">From Idea to Verified </span>
                <span className="block">Smart Contract in One Chat</span>
              </h1>
              <p className="mt-3 font-body text-/55 text-base tracking-normal">Don't code just chat the chain</p>

              {/* Chat input — DApp mode only */}
              <div className="mt-8 w-full max-w-2xl pointer-events-auto">
                <form onSubmit={handleSubmit}>
                  <div className="bg-white/5 rounded-2xl p-4 backdrop-blur-sm transition-colors">
                    <input
                      type="text"
                      placeholder="GM GM! What you wanna ship on chain"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      disabled={isLoading}
                      className="w-full bg-transparent text-white placeholder:text-white/40 focus:outline-none text-lg"
                    />
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                      <span className="text-xs text-white/40 px-2">Full DApp — Contract + Frontend</span>
                      <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className={`rounded-full w-10 h-10 flex items-center justify-center shadow-lg transform transition-all ${
                          !input.trim()
                            ? 'bg-white/6 text-white/30 cursor-not-allowed'
                            : isLoading
                            ? 'bg-white/5 text-white border border-white/30 ring-1 ring-white/20 backdrop-blur-sm opacity-90'
                            : 'bg-white/5 text-white border border-white/20 ring-1 ring-white/20 backdrop-blur-sm hover:scale-105'
                        }`}
                      >
                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2} />}
                      </button>
                    </div>
                  </div>
                </form>
                {error && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </section>

    </>
  )
}

