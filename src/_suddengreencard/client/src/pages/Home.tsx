import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Shield, Zap, Brain, Activity, BarChart3, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import treeBranch from "@assets/generated_images/wide_panoramic_watercolor_cherry_blossom_tree_extending_across_width.png";
import petalImg from "@assets/generated_images/single_cherry_blossom_petal_on_white_background.png";

const SakuraRain = () => {
  const [petals, setPetals] = useState<number[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setPetals((prev) => [...prev, Date.now()].slice(-50)); // Increased petal count
    }, 600); // Increased frequency
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <AnimatePresence>
        {petals.map((id) => (
          <motion.img
            key={id}
            src={petalImg}
            initial={{ 
              x: -50, 
              y: Math.random() * window.innerHeight * 0.1, 
              rotate: 0,
              opacity: 0 
            }}
            animate={{ 
              x: window.innerWidth + 100, 
              y: window.innerHeight + 100,
              rotate: 360 + Math.random() * 720,
              opacity: [0, 0.8, 0.8, 0]
            }}
            transition={{ 
              duration: 10 + Math.random() * 15, 
              ease: "linear"
            }}
            className="absolute w-4 h-4 md:w-8 md:h-8 object-contain mix-blend-multiply"
            style={{
              top: `${Math.random() * 30}%`,
              left: -100
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

const Navigation = () => (
  <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
    <div className="container mx-auto px-6 h-20 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
          <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
        </div>
        <span className="text-xl font-serif font-bold tracking-tight text-foreground">Blossom</span>
      </div>

      <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
        <a href="#features" className="hover:text-primary transition-colors">Capabilities</a>
        <a href="#engine" className="hover:text-primary transition-colors">ElizaOS Engine</a>
        <a href="#roadmap" className="hover:text-primary transition-colors">Roadmap</a>
      </div>

      <Button className="bg-primary hover:bg-primary/90 text-white rounded-full px-6 shadow-lg shadow-primary/20">
        Launch Terminal
      </Button>
    </div>
  </nav>
);

const TerminalDemo = () => {
  const [step, setStep] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const steps = [
    { text: "> Analyzing market structure for ETH/USD...", status: "info" },
    { text: "> Identified bullish divergence on 4H timeframe.", status: "success" },
    { text: "> Executing Long: 10x Leverage, 3% Risk per trade.", status: "warning" },
    { text: "> Position Opened @ $3,450. Stop Loss set at $3,380.", status: "success" },
  ];

  return (
    <div className="w-full max-w-xl mx-auto mt-12 rounded-xl overflow-hidden border border-border bg-white/50 backdrop-blur-xl shadow-2xl shadow-primary/5 ring-1 ring-black/5">
      <div className="bg-muted/50 px-4 py-3 flex items-center gap-2 border-b border-border">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/50 border border-red-600/20" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/50 border border-yellow-600/20" />
          <div className="w-3 h-3 rounded-full bg-green-500/50 border border-green-600/20" />
        </div>
        <div className="ml-4 text-xs text-muted-foreground font-mono">blossom-agent-v2.exe</div>
      </div>
      <div className="p-6 font-mono text-sm min-h-[200px] flex flex-col gap-3 bg-white/80">
        <div className="text-muted-foreground flex gap-2">
          <span className="text-primary font-bold">user@blossom:~$</span>
          <span className="typing-effect text-foreground">Long ETH with 3% risk and manage liquidation</span>
        </div>
        
        {steps.map((s, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: i <= step ? 1 : 0, x: i <= step ? 0 : -10 }}
            className={`flex gap-2 ${
              s.status === "success" ? "text-green-600" : 
              s.status === "warning" ? "text-amber-600" : "text-blue-600"
            }`}
          >
            <span>{">"}</span>
            <span>{s.text}</span>
          </motion.div>
        ))}
        
        {step === 3 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 border-t border-border pt-4"
          >
            <div className="flex justify-between items-center text-xs text-muted-foreground uppercase tracking-wider">
              <span>P&L Live Tracking</span>
              <span className="text-green-600 font-bold animate-pulse">+1.2%</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
  <motion.div 
    whileHover={{ y: -5 }}
    className="group relative p-8 rounded-2xl border border-border bg-white/60 backdrop-blur-sm hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300"
  >
    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary">
      <ArrowRight className="w-5 h-5 -rotate-45" />
    </div>
    <div className="w-12 h-12 rounded-lg bg-primary/5 flex items-center justify-center text-primary mb-6 group-hover:scale-110 transition-transform duration-300">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="text-xl font-serif font-bold mb-3 text-foreground">{title}</h3>
    <p className="text-muted-foreground leading-relaxed">
      {description}
    </p>
  </motion.div>
);

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20 relative overflow-x-hidden">
      <Navigation />
      <SakuraRain />

      {/* Background Tree - Fixed Layer */}
      <div className="fixed top-0 left-0 z-0 w-full h-full pointer-events-none overflow-hidden flex items-center justify-center">
        <img 
          src={treeBranch} 
          alt="Cherry Blossom Tree" 
          className="w-full h-full object-cover opacity-60 mix-blend-multiply" 
        />
      </div>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden z-10">
        <div className="container mx-auto px-6 relative">
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <Badge variant="outline" className="mb-6 border-primary/30 text-primary bg-white/80 px-4 py-1.5 rounded-full text-sm font-medium backdrop-blur-sm shadow-sm">
                Powered by ElizaOS V2
              </Badge>
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-5xl md:text-7xl font-serif font-medium leading-[1.1] tracking-tight mb-6 text-foreground drop-shadow-sm bg-white/30 backdrop-blur-[2px] rounded-3xl px-4 py-2"
            >
              The Intelligent <br />
              <span className="text-primary italic">Execution Layer</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed bg-white/30 backdrop-blur-[2px] rounded-xl p-4"
            >
              Your AI-native copilot for on-chain perps and DeFi. 
              Command strategy, execution, and risk management with natural language.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="w-full"
            >
              <TerminalDemo />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 relative bg-white/20 backdrop-blur-sm z-10">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-serif font-bold mb-4 text-foreground">Engineered for Alpha</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto bg-white/40 backdrop-blur-[2px] rounded-lg p-2">
              Blossom translates your intent into precise on-chain execution, handling the complexities of DeFi while you focus on strategy.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard 
              icon={Brain}
              title="Intelligent Strategy"
              description="Describe your thesis in plain English. Blossom analyzes market structure, identifies setups, and validates entry criteria automatically."
            />
            <FeatureCard 
              icon={Zap}
              title="Execution & Routing"
              description="Best-price execution across multiple AMMs and Perp DEXs. Smart routing minimizes slippage and maximizes capital efficiency."
            />
            <FeatureCard 
              icon={Shield}
              title="Autonomous Risk"
              description="Set-and-forget risk parameters. Blossom monitors positions 24/7, managing liquidation risk and dynamic stop-losses."
            />
          </div>
        </div>
      </section>

      {/* Vision Section */}
      <section className="py-24 relative overflow-hidden z-10">
        <div className="container mx-auto px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="bg-white/30 backdrop-blur-sm rounded-3xl p-8">
              <h2 className="text-3xl md:text-5xl font-serif font-bold mb-6 leading-tight text-foreground">
                Trade Anything. <br />
                <span className="text-primary">Any Chain. Anywhere.</span>
              </h2>
              <div className="space-y-6 text-lg text-muted-foreground">
                <p>
                  We envision Blossom as the universal interface for value exchange. Today, it's perps. Tomorrow, it's everything.
                </p>
                <ul className="space-y-3 mt-8">
                  {[
                    "Pre-IPO Companies",
                    "Event Contracts & Prediction Markets",
                    "Exotic Futures (Labubu, Sneakers, Art)",
                    "Cross-chain Arbitrage"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground/80 font-medium">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <Button variant="outline" className="mt-10 border-border hover:bg-secondary/50 h-12 px-8 rounded-full text-foreground bg-white/50">
                Read the Vision Paper
              </Button>
            </div>

            <div className="relative">
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-white/60 border-border backdrop-blur-md p-6 translate-y-8 shadow-lg shadow-black/5">
                  <Activity className="w-8 h-8 text-primary mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-foreground">$24.5M</div>
                  <div className="text-sm text-muted-foreground">Volume Processed</div>
                </Card>
                <Card className="bg-white/60 border-border backdrop-blur-md p-6 shadow-lg shadow-black/5">
                  <Terminal className="w-8 h-8 text-blue-500 mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-foreground">12ms</div>
                  <div className="text-sm text-muted-foreground">Execution Latency</div>
                </Card>
                <Card className="bg-white/60 border-border backdrop-blur-md p-6 translate-y-8 shadow-lg shadow-black/5">
                  <Globe className="w-8 h-8 text-purple-500 mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-foreground">12</div>
                  <div className="text-sm text-muted-foreground">Chains Supported</div>
                </Card>
                <Card className="bg-white/60 border-border backdrop-blur-md p-6 shadow-lg shadow-black/5">
                  <BarChart3 className="w-8 h-8 text-green-500 mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-foreground">99.9%</div>
                  <div className="text-sm text-muted-foreground">Uptime</div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border bg-white/80 backdrop-blur-md relative z-10">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
             <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
              <div className="w-2 h-2 rounded-full bg-primary" />
            </div>
            <span className="font-serif font-bold text-foreground">Blossom</span>
          </div>
          
          <div className="text-sm text-muted-foreground">
            © 2024 Blossom Protocol. Built with ElizaOS.
          </div>

          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-primary transition-colors">Twitter</a>
            <a href="#" className="hover:text-primary transition-colors">Discord</a>
            <a href="#" className="hover:text-primary transition-colors">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}