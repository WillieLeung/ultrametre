int enA = 9;
int in1 = 8;
int in2 = 7;
int enB = 3;
int in3 = 4;
int in4 = 2;
int trigPin = 11;
int echoPin = 12;
bool solanaTriggered = false;

void setup() {
  Serial.begin(9600);
  pinMode(enA, OUTPUT);
  pinMode(in1, OUTPUT);
  pinMode(in2, OUTPUT);
  pinMode(enB, OUTPUT);
  pinMode(in3, OUTPUT);
  pinMode(in4, OUTPUT);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(13, OUTPUT);
  
  digitalWrite(13, LOW);
  Serial.println("ARDUINO_READY_TO_RECEIVE");
}

long getSmoothDistance() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long d = pulseIn(echoPin, HIGH, 20000);
  if (d == 0) return 200;
  return d * 0.034 / 2;
}

void move(int sA, int sB, int i1, int i2, int i3, int i4) {
  digitalWrite(in1, i1);
  digitalWrite(in2, i2);
  digitalWrite(in3, i3);
  digitalWrite(in4, i4);
  analogWrite(enA, sA);
  analogWrite(enB, sB);
}

void loop() {
  if (Serial.available() > 0) {
    char data = Serial.read();
    Serial.print("DATA_RECEIVED_BY_CHIP: ");
    Serial.println(data);
    
    if (data == 'F') {
      solanaTriggered = true;
      digitalWrite(13, HIGH);
      Serial.println("HANDSHAKE_CONFIRMED_STARTING_MOTORS");
      delay(10000);
    }
  }

  if (solanaTriggered) {
    long distance = getSmoothDistance();
    if (distance < 30) {
      move(0, 0, LOW, LOW, LOW, LOW);
      delay(300);
      move(180, 180, HIGH, LOW, HIGH, LOW); 
      delay(500);
      move(200, 200, HIGH, LOW, LOW, HIGH); 
      delay(250);
    } else {
      move(255, 255, LOW, HIGH, LOW, HIGH);
    }
  } else {
    move(0, 0, LOW, LOW, LOW, LOW);
  }
  delay(10);
}