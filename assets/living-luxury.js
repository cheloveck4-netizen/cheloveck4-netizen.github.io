/* Progressive enhancements only. No content is hidden awaiting JavaScript. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mobile = window.matchMedia('(max-width: 740px)');
  var vitrine = document.querySelector('.journal-vitrine');
  var cta = document.querySelector('.mobile-cta');
  var observer;
  var seen = new WeakSet();
  var headings = document.querySelectorAll('.section-intro h2, #about-h, #rules-h, #journal-latest-title, #contacts-h, #social-heading');
  var cards = document.querySelectorAll('.price-card, .step, .problem, .article, .journal-latest-grid > a');
  function configureMotion() {
    if (observer) observer.disconnect();
    if (reduce.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || reduce.matches) return;
        entry.target.classList.add('living-entered');
        seen.add(entry.target);
        observer.unobserve(entry.target);
      });
    }, {rootMargin:'0px 0px -65px 0px', threshold:0.08});
    headings.forEach(function (el) {
      el.classList.add('living-heading');
      if (!seen.has(el)) observer.observe(el);
    });
    cards.forEach(function (el) { if (!seen.has(el)) observer.observe(el); });
  }
  configureMotion();
  if ('IntersectionObserver' in window && !reduce.matches) {
    var washObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (!entry.isIntersecting || reduce.matches) return;
        entry.target.classList.add('living-wash');
        washObserver.unobserve(entry.target);
      });
    },{rootMargin:'0px 0px -90px 0px',threshold:0});
    document.querySelectorAll('#services,#help,#process').forEach(function(el){washObserver.observe(el);});
  }
  document.querySelectorAll('.hero-ctas .button,.price-card .button,.contact-panel .button').forEach(function(el){
    el.classList.add('living-touch');
    el.addEventListener('pointerdown',function(event){
      if (reduce.matches) return;
      var r=el.getBoundingClientRect();
      el.style.setProperty('--touch-x',Math.max(0,Math.min(100,(event.clientX-r.left)/r.width*100))+'%');
      el.style.setProperty('--touch-y',Math.max(0,Math.min(100,(event.clientY-r.top)/r.height*100))+'%');
      el.classList.remove('living-lit');
      void el.offsetWidth;
      el.classList.add('living-lit');
    },{passive:true});
    el.addEventListener('animationend',function(event){if(event.animationName==='living-touch-light')el.classList.remove('living-lit');});
  });
  if (reduce.addEventListener) reduce.addEventListener('change', configureMotion);
  else if (reduce.addListener) reduce.addListener(configureMotion);
  if (vitrine && 'IntersectionObserver' in window) {
    vitrine.classList.add('living-managed');
    var glossObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('living-visible',entry.isIntersecting);
        if (entry.isIntersecting && !reduce.matches && !entry.target.classList.contains('living-fan')) {
          entry.target.classList.add('living-fan');
        }
      });
    });
    glossObserver.observe(vitrine);
  }
  // Keep the existing fixed consultation link, but temporarily yield to the
  // journal when its visible card actually intersects the link's rectangle.
  if (!vitrine || !cta) return;
  var scheduled = false;
  function checkCollision() {
    scheduled = false;
    if (!mobile.matches) {
      cta.classList.remove('living-avoid-vitrine');
      return;
    }
    var v = vitrine.getBoundingClientRect(), c = cta.getBoundingClientRect();
    var overlap = c.width > 0 && c.height > 0 && v.bottom > c.top-6 &&
      v.top < c.bottom && v.right > c.left && v.left < c.right;
    cta.classList.toggle('living-avoid-vitrine',overlap);
  }
  function requestCheck() {
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(checkCollision); }
  }
  window.addEventListener('scroll',requestCheck,{passive:true});
  window.addEventListener('resize',requestCheck,{passive:true});
  window.addEventListener('load',requestCheck,{once:true});
  if (window.visualViewport) window.visualViewport.addEventListener('resize',requestCheck,{passive:true});
  if ('ResizeObserver' in window) {
    var size = new ResizeObserver(requestCheck);
    size.observe(vitrine);
    size.observe(cta);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestCheck);
  requestCheck();
})();
