import { useState } from 'react';
import { MessageIcon, LightningIcon, ShieldIcon, GlobeIcon } from './FeatureIcons';

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
      <section id="features" className="py-24 px-6 relative z-10 bg-white/20 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-[#111111]" style={{
              fontFamily: '"Playfair Display", Georgia, serif',
            }}>
              Engineered for Alpha
            </h2>
            <p className="text-[#666666] max-w-2xl mx-auto bg-white/40 backdrop-blur-[2px] rounded-lg p-2">
              Blossom translates your intent into precise on-chain execution, handling the complexities of DeFi while you focus on strategy.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: 'Natural Language Intent',
                description: 'Tell Blossom what you want in plain English; it translates into structured strategies.',
                Icon: MessageIcon,
              },
              {
                title: 'Smart Execution',
                description: 'Optimized routing across venues and chains for best price and minimal slippage.',
                Icon: LightningIcon,
              },
              {
                title: 'Active Risk Management',
                description: 'Risk limits, liquidation buffers, and correlation tracking built into every strategy.',
                Icon: ShieldIcon,
              },
              {
                title: 'Universal Asset Support',
                description: 'From blue-chip crypto to pre-IPO, prediction markets, and sports — one interface.',
                Icon: GlobeIcon,
              },
            ].map((feature, idx) => {
              // Alternate between pink and purple for visual interest
              const iconColor = idx % 2 === 0 ? '#F25AA2' : '#C29FFF';
              return (
                <div key={idx} className="group relative p-8 rounded-2xl border border-[#E5E5E5] bg-white/60 backdrop-blur-sm hover:shadow-xl hover:shadow-[#F25AA2]/5 hover:border-[#F25AA2]/20 transition-all duration-300 cursor-pointer" style={{
                  transform: 'translateY(0)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-5px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                }}>
                  <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity text-[#F25AA2]">
                    <svg className="w-5 h-5 -rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="w-12 h-12 rounded-lg bg-[#F25AA2]/5 flex items-center justify-center text-[#F25AA2] mb-6 group-hover:scale-110 transition-transform duration-300">
                    <feature.Icon className="w-6 h-6" strokeWidth={2} />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-[#111111]" style={{
                    fontFamily: '"Playfair Display", Georgia, serif',
                  }}>
                    {feature.title}
                  </h3>
                  <p className="text-[#666666] leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Cross-Chain & Cross-Venue */}
      <section className="py-20 px-6 relative z-10 bg-[#FFF7FB]">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-[#111111] mb-4">
                Cross-Chain & Cross-Venue
              </h2>
              <p className="text-lg text-[#333333] mb-6" style={{ lineHeight: '1.5' }}>
                Blossom abstracts away the complexity of multiple chains and venues. Whether you're trading on-chain perps, 
                deploying DeFi strategies, or participating in prediction markets, Blossom provides a unified interface 
                that routes your intent to the optimal execution venue.
              </p>
              <ul className="space-y-3 text-[#444444]">
                <li className="flex items-start gap-2">
                  <span className="text-[#FF5FA8] mt-1">✓</span>
                  <span>On-chain perps (Hyperliquid, GMX, etc.)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF5FA8] mt-1">✓</span>
                  <span>DeFi yield strategies (Kamino, RootsFi, Jet)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF5FA8] mt-1">✓</span>
                  <span>Prediction markets (Kalshi, Polymarket)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FF5FA8] mt-1">✓</span>
                  <span>Coming soon: Sports markets, pre-IPO, stocks</span>
                </li>
              </ul>
            </div>
            <div className="bg-white p-8" style={{
              borderRadius: '16px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.04)',
              border: '1px solid #F3E5EC',
            }}>
              <div className="grid grid-cols-3 gap-4 mb-4">
                {['On-chain', 'CeFi', 'Prediction Markets'].map((label, idx) => (
                  <div
                    key={idx}
                    className="aspect-square flex items-center justify-center" style={{
                      borderRadius: '16px',
                      backgroundColor: '#FFD6E6',
                      border: '1px solid #F3E5EC',
                    }}
                  >
                    <span className="text-sm font-medium text-[#111111] text-center">{label}</span>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <div className="text-sm text-[#444444] mb-2">↓</div>
                <div className="text-sm font-medium text-[#111111]">Blossom Execution Layer</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ready to Bloom? Waitlist */}
      <section className="py-20 px-6 relative z-10 bg-[#FFF7FB]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-[#111111] mb-4">Ready to Bloom?</h2>
          <p className="text-lg text-[#333333] mb-8" style={{ lineHeight: '1.5' }}>
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
                className="flex-1 px-4 py-3 rounded-full border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF5FA8]/50 text-[#111827] placeholder:text-[#4B5563] shadow-sm"
              />
              <button
                type="submit"
                disabled={submitted}
                className="px-6 py-3 text-base font-medium text-white bg-[#F25AA2] rounded-full hover:bg-[#FF4B8A] transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
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

