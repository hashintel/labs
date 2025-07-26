describe("hash.ai platform testing", () => {
  it("tests sign in & go to core", () => {
    cy.visit("https://hash.ai/");
    cy.contains("Sign in").click();
    cy.url().should("eq", "https://hash.ai/signin?redirect=/");

    // Sign in
    cy.frameLoaded(".login-frame");
    cy.enter(".login-frame").then((getBody) => {
      getBody()
        .find('input[type="email"]')
        .should("be.visible")
        .type("1llyanovohatskyy@gmail.com");
      getBody()
        .find('input[type="password"]')
        .should("be.visible")
        .type("Test1ngCypress");
      getBody().contains("Log In").click();
    });

    cy.url().should("eq", "https://hash.ai/");
    cy.contains("Core").click();
  });

  it("tests that a simulation runs", () => {
    // Simulation running
    cy.url().should("contain", "https://core.hash.ai/");
    cy.wait(15000); // Enabled-disabled state of the simulation player buttons
    cy.get(".IconRunFast").click();
    // No errors should popup
    cy.wait(5000);
    cy.get(".IconPause").click();
    cy.get(".timeline .step.last").should(($timeline) => {
      const timesteps = parseInt($timeline.text());
      expect(timesteps).to.be.greaterThan(5);
    });
  });

  it("adds and removes behaviors", () => {
    // Removing old behavior if it exists
    const simulationFileElementSelector =
      '.HashCoreFiles ul span[title="@hash/bid.js"]';
    cy.get("body").then(($el) => {
      if ($el.has(simulationFileElementSelector)) {
        cy.get(`${simulationFileElementSelector} + .delete`).click();
        cy.contains("CONFIRM DELETION").click();
      }
    });

    // Adding new behavior
    cy.get(".Search__Input").type("bid");
    cy.get('button[title="Bid"]').click();
    cy.contains("Add to Project").click();
    cy.get(simulationFileElementSelector).should(
      "have.attr",
      "title",
      "@hash/bid.js",
    );
  });
});
