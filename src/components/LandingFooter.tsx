export function LandingFooter() {
  return (
    <footer className="py-12 px-6 border-t border-pink-100 bg-white relative z-10">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-3">Product</h3>
            <ul className="space-y-2 text-sm text-[#555555]">
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Features</a></li>
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Pricing</a></li>
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Roadmap</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-3">Resources</h3>
            <ul className="space-y-2 text-sm text-[#555555]">
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Documentation</a></li>
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Support</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-3">Legal</h3>
            <ul className="space-y-2 text-sm text-[#555555]">
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Privacy</a></li>
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Terms</a></li>
              <li><a href="#" className="hover:text-[#FF4B8A] transition-colors">Disclaimer</a></li>
            </ul>
          </div>
        </div>
        <div className="pt-8 border-t border-pink-100 text-center text-xs text-[#555555]">
          <p>© 2024 Blossom AI. SIM mode only — no real trades.</p>
        </div>
      </div>
    </footer>
  );
}

