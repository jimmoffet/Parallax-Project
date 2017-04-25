var fingers;

function setup() {
  createCanvas(390, 240);
  fingers = createCapture(VIDEO);
  //fingers.loop();
  fingers.hide();
  noStroke();
  fill(0);
}

function draw() {
  image(fingers, 0, 0, 320, 180);
}