import { useState } from 'react';

export function FeatureSections() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Waitlist submission:', email);
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setEmail('');
    }, 3000);
  };

  return (
    <>
      {/* Intelligence for Modern Markets */}
      <section className="py-24 px-6 relative z-10 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-[#171717] mb-4">
              Intelligence for Modern Markets
            </h2>
            <p className="text-lg md:text-xl text-[#555555] max-w-2xl mx-auto">
              Blossom combines AI reasoning with execution infrastructure to give you a single interface for all markets.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: 'Natural Language Intent',
                description: 'Tell Blossom what you want in plain English; it translates into structured strategies.',
                icon: '💬',
              },
              {
                title: 'Smart Execution',
                description: 'Optimized routing across venues and chains for best price and minimal slippage.',
                icon: '⚡',
              },
              {
                title: 'Active Risk Management',
                description: 'Risk limits, liquidation buffers, and correlation tracking built into every strategy.',
                icon: '🛡️',
              },
              {
                title: 'Universal Asset Support',
                description: 'From blue-chip crypto to pre-IPO, prediction markets, and sports — one interface.',
                icon: '🌐',
              },
            ].map((feature, idx) => (
              <div key={idx} className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-all border border-pink-50">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-[#171717] mb-2">{feature.title}</h3>
                <p className="text-[#555555] text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cross-Chain & Cross-Venue */}
      <section className="py-24 px-6 relative z-10 bg-[#FFF7FB]">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-[#171717] mb-4">
                Cross-Chain & Cross-Venue
              </h2>
              <p className="text-lg text-[#555555] mb-6 leading-relaxed">
                Blossom abstracts away the complexity of multiple chains and venues. Whether you're trading on-chain perps, 
                deploying DeFi strategies, or participating in prediction markets, Blossom provides a unified interface 
                that routes your intent to the optimal execution venue.
              </p>
              <ul className="space-y-3 text-[#555555]">
                <li className="flex items-start gap-2">
                  <span className="text-[#FF66A0] mt-1">✓</span>
                  <span>On-chain perps (Hyperliquid, GMX, etc.)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF66A0] mt-1">✓</span>
                  <span>DeFi yield strategies (Kamino, RootsFi, Jet)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF66A0] mt-1">✓</span>
                  <span>Prediction markets (Kalshi, Polymarket)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF66A0] mt-1">✓</span>
                  <span>Coming soon: Sports markets, pre-IPO, stocks</span>
                </li>
              </ul>
            </div>
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-pink-100">
              <div className="grid grid-cols-3 gap-4 mb-4">
                {['On-chain', 'CeFi', 'Prediction Markets'].map((label, idx) => (
                  <div
                    key={idx}
                    className="aspect-square rounded-2xl bg-[#FFD6E6] flex items-center justify-center border border-pink-200"
                  >
                    <span className="text-sm font-medium text-[#171717] text-center">{label}</span>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <div className="text-sm text-[#555555] mb-2">↓</div>
                <div className="text-sm font-medium text-[#171717]">Blossom Execution Layer</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ready to Bloom? Waitlist */}
      <section className="py-24 px-6 relative z-10 bg-[#FFF7FB]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-[#171717] mb-4">Ready to Bloom?</h2>
          <p className="text-lg text-[#555555] mb-8">
            Join the waitlist for early access to the intelligent execution layer.
          </p>

          <form onSubmit={handleWaitlistSubmit} className="max-w-md mx-auto">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                className="flex-1 px-4 py-3 rounded-full border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF66A0]/50 text-[#171717] placeholder:text-[#555555] shadow-sm"
              />
              <button
                type="submit"
                disabled={submitted}
                className="px-6 py-3 text-base font-medium text-white bg-[#FF66A0] rounded-full hover:bg-[#FF4B8A] transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitted ? 'Joined!' : 'Join Waitlist'}
              </button>
            </div>
            {submitted && (
              <p className="mt-4 text-sm text-blossom-success">
                Thanks! We'll be in touch soon.
              </p>
            )}
          </form>
        </div>
      </section>
    </>
  );
}

