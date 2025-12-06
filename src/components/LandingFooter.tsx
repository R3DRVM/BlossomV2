export function LandingFooter() {
  return (
    <footer className="py-12 px-6 border-t border-blossom-outline/30 bg-white/50">
      <div className="container mx-auto max-w-6xl">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="text-sm font-semibold text-blossom-ink mb-3">Product</h3>
            <ul className="space-y-2 text-sm text-blossom-slate">
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Features</a></li>
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Pricing</a></li>
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Roadmap</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-blossom-ink mb-3">Resources</h3>
            <ul className="space-y-2 text-sm text-blossom-slate">
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Documentation</a></li>
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Support</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-blossom-ink mb-3">Legal</h3>
            <ul className="space-y-2 text-sm text-blossom-slate">
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Privacy</a></li>
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Terms</a></li>
              <li><a href="#" className="hover:text-blossom-ink transition-colors">Disclaimer</a></li>
            </ul>
          </div>
        </div>
        <div className="pt-8 border-t border-blossom-outline/30 text-center text-sm text-blossom-slate">
          <p>© 2024 Blossom AI. All rights reserved. SIM mode only — no real trades.</p>
        </div>
      </div>
    </footer>
  );
}

