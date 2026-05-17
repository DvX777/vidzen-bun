'use client'
import Navbar from './components/landing/Navbar'
import Hero from './components/landing/Hero'
import Docs from './components/landing/Docs'
import Sandbox from './components/landing/Sandbox'
import Footer from './components/landing/Footer'

export default function HomePage() {
  return (
    <>
      {/* Noise texture overlay */}
      <div className="noise" />
      <Navbar />
      <Hero />
      <Docs />
      <Sandbox />
      <Footer />
    </>
  )
}
