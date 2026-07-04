// =============================
// Dark Mode
// =============================
const themeBtn = document.getElementById("themeToggle");

// Load saved theme
if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark");
    themeBtn.textContent = "☀️";
} else {
    themeBtn.textContent = "🌙";
}

// Toggle theme
themeBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark");

    if (document.body.classList.contains("dark")) {
        themeBtn.textContent = "☀️";
        localStorage.setItem("theme", "dark");
    } else {
        themeBtn.textContent = "🌙";
        localStorage.setItem("theme", "light");
    }
});

// =============================
// Counter Animation
// =============================
const counters = document.querySelectorAll("[data-target]");
const startCounter = (counter)=>{
    const target = +counter.dataset.target;
    let count = 0;
    const speed = target / 150;
    const update = ()=>{
        count += speed;
        if(count < target){
            counter.textContent = Math.floor(count);
            requestAnimationFrame(update);
        }else{
            counter.textContent = target;
        }
    }
    update();
}

const counterObserver = new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
        if(entry.isIntersecting){
            startCounter(entry.target);
            counterObserver.unobserve(entry.target);
        }
    });
});

counters.forEach(counter=>{
    counterObserver.observe(counter);
});

// =============================
// Fade In Animation
// =============================
const fadeItems = document.querySelectorAll(".fade-up");
const fadeObserver = new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
        if(entry.isIntersecting){
            entry.target.classList.add("visible");
        }
    });
},{
    threshold:.2
});

fadeItems.forEach(item=>{
    fadeObserver.observe(item);
});

// =============================
// Smooth Scroll
// =============================
document.querySelectorAll('a[href^="#"]').forEach(link=>{
    link.addEventListener("click",function(e){
        e.preventDefault();
        document.querySelector(this.getAttribute("href"))
        .scrollIntoView({
            behavior:"smooth"
        });
        nav.classList.remove("show");
    });
});

// =============================
// Sticky Navbar Shadow
// =============================
const navbar = document.querySelector(".navbar");
window.addEventListener("scroll",()=>{
    if(window.scrollY > 20){
        navbar.classList.add("scrolled");
    }else{
        navbar.classList.remove("scrolled");
    }
});

// =============================
// Back To Top
// =============================
const topBtn = document.getElementById("backToTop");
window.addEventListener("scroll",()=>{
    if(window.scrollY > 500){
        topBtn.classList.add("show");
    }else{
        topBtn.classList.remove("show");
    }
});

topBtn.addEventListener("click",()=>{
    window.scrollTo({
        top:0,
        behavior:"smooth"
    });
});

// =============================
// Typing Effect
// =============================
const heroTitle = document.querySelector(".hero h1");
const originalText = heroTitle.textContent;
heroTitle.textContent = "";
let i = 0;
function typeWriter(){
    if(i < originalText.length){
        heroTitle.textContent += originalText.charAt(i);
        i++;
        setTimeout(typeWriter,60);
    }
}
window.addEventListener("load",typeWriter);

// =============================
// Floating Elements
// =============================
document.querySelectorAll(".float").forEach(item=>{
    let direction = 1;
    let offset = 0;
    setInterval(()=>{
        offset += direction;
        item.style.transform =
        `translateY(${offset}px)`;
        if(offset > 10) direction = -1;
        if(offset < -10) direction = 1;
    },35);
});

// =============================
// Current Year
// =============================
const year = document.querySelector("#year");
if(year){
    year.textContent = new Date().getFullYear();
}
console.log("FunSite Loaded Successfully 🚀");