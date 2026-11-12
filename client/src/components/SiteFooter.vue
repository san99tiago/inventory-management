<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <svg
          class="flag"
          viewBox="0 0 900 600"
          role="img"
          aria-label="Bandera de Colombia"
        >
          <rect x="0" y="0" width="900" height="300" fill="#FCD116" />
          <rect x="0" y="300" width="900" height="150" fill="#003893" />
          <rect x="0" y="450" width="900" height="150" fill="#CE1126" />
        </svg>
        <strong class="footer-message">Vamos con toda Amazon Colombia!</strong>
      </div>
      <p class="footer-disclaimer">
        <span class="footer-pill">Demo</span>
        DEMO: This project is a demo built for the Anthropic Hackathon. It is a simple example of Claude Code features. All data is mock data. Not for production use.
      </p>
    </div>
  </footer>
</template>

<script>
export default {
  name: 'SiteFooter'
}
</script>

<style scoped>
/* 2026-11-12: Gutters match .main-content (2rem, 1rem at <=640px) so the footer
   lines up with the page content on every width. */
.site-footer {
  background: #ffffff;
  border-top: 1px solid #e2e8f0;
  padding: 1.5rem 2rem;
}

.footer-inner {
  max-width: 1600px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 2rem;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.flag {
  width: 36px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 3px;
  border: 1px solid #e2e8f0;
}

.footer-message {
  color: #0f172a;
  font-size: 0.938rem;
  font-weight: 700;
}

.footer-disclaimer {
  flex: 1 1 24rem;
  min-width: 0;
  color: #64748b;
  font-size: 0.813rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.footer-pill {
  display: inline-block;
  margin-right: 0.5rem;
  padding: 0.125rem 0.5rem;
  border-radius: 6px;
  background: #dbeafe;
  color: #1e40af;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

@media (max-width: 640px) {
  .site-footer {
    padding: 1.25rem 1rem;
  }
}
</style>
