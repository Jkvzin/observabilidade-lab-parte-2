const end = Date.now() + 5000; // 5 segundos de CPU a 100%
while (Date.now() < end) {
    Math.random() * Math.random();
}
