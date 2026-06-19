import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0e] text-white">
      {/* Navigation */}
      <nav className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-b from-blue-400 to-blue-600 flex items-center justify-center text-sm">
              ✉
            </div>
            <span className="font-semibold text-lg">Email Outreach</span>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg bg-gradient-to-b from-blue-400 to-blue-600 text-white font-semibold text-sm hover:from-blue-300 hover:to-blue-500 transition-all"
          >
            Open Dashboard
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-medium mb-6">
          Cloud-powered cold email automation
        </div>

        <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
          Send personalized cold emails
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-600">
            at scale with AI
          </span>
        </h1>

        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          Import leads, generate AI-powered personalized emails, and run automated sequences.
          Your outreach engine runs 24/7 in the cloud.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className="px-8 py-3 rounded-lg bg-gradient-to-b from-blue-400 to-blue-600 text-white font-semibold hover:from-blue-300 hover:to-blue-500 transition-all shadow-lg shadow-blue-500/25"
          >
            Get Started
          </Link>
          <a
            href="#features"
            className="px-8 py-3 rounded-lg border border-white/20 text-gray-300 font-semibold hover:border-white/40 hover:text-white transition-all"
          >
            Learn More
          </a>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Everything you need for cold outreach</h2>
          <p className="text-gray-400">A complete system, not just another tool.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Feature 1 */}
          <div className="p-6 rounded-xl bg-[#14141a] border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
              📥
            </div>
            <h3 className="font-semibold text-lg mb-2">Smart Import</h3>
            <p className="text-gray-400 text-sm">
              Upload CSV or Excel files. Auto-detect columns and map to lead fields with one click.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="p-6 rounded-xl bg-[#14141a] border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
              🤖
            </div>
            <h3 className="font-semibold text-lg mb-2">AI Personalization</h3>
            <p className="text-gray-400 text-sm">
              Generate unique email bodies and subject lines for each lead using GPT-4. No templates needed.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="p-6 rounded-xl bg-[#14141a] border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
              ✅
            </div>
            <h3 className="font-semibold text-lg mb-2">Email Verification</h3>
            <p className="text-gray-400 text-sm">
              Validate emails before sending. Catch invalid addresses and protect your sender reputation.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="p-6 rounded-xl bg-[#14141a] border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
              📧
            </div>
            <h3 className="font-semibold text-lg mb-2">Multi-Step Sequences</h3>
            <p className="text-gray-400 text-sm">
              Create follow-up sequences with customizable delays. Automated persistence that works.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="p-6 rounded-xl bg-[#14141a] border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
              ⚡
            </div>
            <h3 className="font-semibold text-lg mb-2">Smart Sending</h3>
            <p className="text-gray-400 text-sm">
              Random delays between emails, daily caps, and automatic pause on delivery issues.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="p-6 rounded-xl bg-[#14141a] border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
              ☁️
            </div>
            <h3 className="font-semibold text-lg mb-2">Cloud-Powered</h3>
            <p className="text-gray-400 text-sm">
              Runs 24/7 without your computer. Your campaigns keep sending even when you're asleep.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Simple 5-step workflow</h2>
          <p className="text-gray-400">From import to inbox in minutes.</p>
        </div>

        <div className="grid md:grid-cols-5 gap-4">
          {[
            { num: '1', title: 'Connect', desc: 'Set up SMTP & API keys' },
            { num: '2', title: 'Import', desc: 'Upload your lead list' },
            { num: '3', title: 'Verify', desc: 'Validate email addresses' },
            { num: '4', title: 'Campaign', desc: 'Create your sequence' },
            { num: '5', title: 'Send', desc: 'Start the queue' },
          ].map((step, i) => (
            <div key={i} className="text-center">
              <div className="w-12 h-12 rounded-full bg-gradient-to-b from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold mx-auto mb-3">
                {step.num}
              </div>
              <h3 className="font-semibold mb-1">{step.title}</h3>
              <p className="text-gray-400 text-sm">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="rounded-2xl bg-gradient-to-br from-blue-600/20 to-blue-900/20 border border-blue-500/20 p-12 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to scale your outreach?</h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Stop sending emails one by one. Let AI personalize your outreach while you focus on closing deals.
          </p>
          <Link
            href="/dashboard"
            className="inline-block px-8 py-3 rounded-lg bg-gradient-to-b from-blue-400 to-blue-600 text-white font-semibold hover:from-blue-300 hover:to-blue-500 transition-all shadow-lg shadow-blue-500/25"
          >
            Open Dashboard
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-gradient-to-b from-blue-400 to-blue-600 flex items-center justify-center text-xs">
              ✉
            </div>
            <span>Email Outreach</span>
          </div>
          <div>
            © {new Date().getFullYear()} Email Outreach
          </div>
        </div>
      </footer>
    </div>
  )
}
